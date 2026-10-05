-- Run against a migrated database. All fixtures and assertions roll back.
begin;
create function pg_temp.check_asset_search(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Asset search assertion failed: %',message; end if; end $$;

insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000081','asset-search-worker@example.test'),
 ('10000000-0000-0000-0000-000000000082','asset-search-employee@example.test'),
 ('10000000-0000-0000-0000-000000000083','asset-search-outsider@example.test');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000081','Asset search fixtures','asset-search-fixtures'),
 ('20000000-0000-0000-0000-000000000082','Other asset search fixtures','other-asset-search-fixtures');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000081','technician'),
 ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000082','end_user'),
 ('20000000-0000-0000-0000-000000000082','10000000-0000-0000-0000-000000000083','technician');
insert into public.assets(organization_id,tag,name,kind,status,serial_number,model,assigned_user_id) values
 ('20000000-0000-0000-0000-000000000081','SEARCH-PC-1','Reception laptop','computer','in_use','1234567890','HP EliteBook 850','10000000-0000-0000-0000-000000000082'),
 ('20000000-0000-0000-0000-000000000081','SEARCH-PC-2','Front desk desktop','computer','repair','0012345999','Dell OptiPlex',null),
 ('20000000-0000-0000-0000-000000000081','SEARCH-PC-3','Stock computer','computer','available','X-67890-Z',null,null),
 ('20000000-0000-0000-0000-000000000081',E'LITERAL%_\\*"(),.O''NEIL','Punctuation device','other','available',null,null,null),
 ('20000000-0000-0000-0000-000000000082','OUTSIDE-PC','Reception laptop','computer','available','1234560000','HP EliteBook',null);
insert into public.assets(organization_id,tag,name,kind)
 select '20000000-0000-0000-0000-000000000081','PAGE-'||n,'Paged device','computer' from generate_series(1,30) as n;

select pg_temp.check_asset_search(not has_function_privilege('anon','public.search_assets(uuid,text)','EXECUTE'),'anonymous callers cannot invoke search');
select pg_temp.check_asset_search((select not prosecdef from pg_proc where oid='public.search_assets(uuid,text)'::regprocedure),'search uses caller permissions');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000081","aal":"aal1"}',true);
select pg_temp.check_asset_search((select count(*)=2 from public.search_assets('20000000-0000-0000-0000-000000000081','12345')),'serial prefixes and middle fragments match');
select pg_temp.check_asset_search((select count(*)=2 from public.search_assets('20000000-0000-0000-0000-000000000081','67890')),'serial suffixes match');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','cept')),'partial names match');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','pc-2')),'partial tags ignore case');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','eliteb')),'partial models ignore case');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081',E'  12345\tHP\n850  ')),'all terms match across different fields regardless of order');
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000081','12345 Missing')),'every term is required');
select pg_temp.check_asset_search((select count(*)=3 from public.search_assets('20000000-0000-0000-0000-000000000081','PC')),'two-character searches remain supported');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','12345') where status='repair'),'lifecycle combines with search');
select pg_temp.check_asset_search((select count(*)=34 from public.search_assets('20000000-0000-0000-0000-000000000081','')),'empty search returns visible inventory');
select pg_temp.check_asset_search((select count(*)=34 from public.search_assets('20000000-0000-0000-0000-000000000081',E' \t\n ')),'whitespace search is empty');
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000081',repeat('9',10000))),'oversized queries are bounded');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','%')),'percent is literal, not a wildcard');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','_')),'underscore is literal, not a wildcard');
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081',E'\\*"(),.O''NEIL')),'backslashes, stars, quotes and punctuation remain literal');
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000081','x%'' OR true --')),'query syntax cannot alter the filter');
select pg_temp.check_asset_search((select count(*)=30 from public.search_assets('20000000-0000-0000-0000-000000000081','Paged')),'count includes every matching page');
select pg_temp.check_asset_search((select count(*)=5 from (select id from public.search_assets('20000000-0000-0000-0000-000000000081','Paged') order by updated_at desc,id limit 25 offset 25) results),'database pagination returns the final page');
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000082','12345')),'organization argument cannot bypass RLS');

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000082","aal":"aal1"}',true);
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','12345')),'employee sees only their assigned matching asset');
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000081','Dell')),'employee cannot infer unassigned assets');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'10000000-0000-0000-0000-000000000082','totp','verified',now(),now());
set local role authenticated;
select pg_temp.check_asset_search((select count(*)=0 from public.search_assets('20000000-0000-0000-0000-000000000081','12345')),'required MFA is enforced');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000082","aal":"aal2"}',true);
select pg_temp.check_asset_search((select count(*)=1 from public.search_assets('20000000-0000-0000-0000-000000000081','12345')),'verified MFA restores authorized matches');
reset role;
rollback;
