-- Synthetic fixtures only; all records, sessions and MFA factors roll back.
begin;
create function pg_temp.check_universal_search(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Universal search assertion failed: %',message; end if; end $$;
create temporary table search_fixture as select gen_random_uuid() staff,gen_random_uuid() employee,gen_random_uuid() outsider,gen_random_uuid() owner,gen_random_uuid() org,gen_random_uuid() other_org,gen_random_uuid() ticket,gen_random_uuid() session;
grant select on search_fixture to authenticated;
insert into auth.users(id,email) select staff,'staff-'||staff||'@example.test' from search_fixture union all select employee,'employee-'||employee||'@example.test' from search_fixture union all select outsider,'outsider-'||outsider||'@example.test' from search_fixture union all select owner,'owner-'||owner||'@example.test' from search_fixture;
insert into public.organizations(id,name,slug) select org,'Universal 100% Lab','universal-needle-'||org from search_fixture union all select other_org,'Other laboratory','outsider-lab-'||other_org from search_fixture;
insert into public.organization_memberships(organization_id,user_id,role) select org,staff,'administrator'::public.app_role from search_fixture union all select org,employee,'end_user' from search_fixture union all select other_org,outsider,'administrator' from search_fixture;
insert into public.profiles(organization_id,user_id,display_name,email,job_title) select org,staff,'Devon O''Neil','devon_oneil@example.test','Systems Engineer' from search_fixture union all select org,employee,'Jordan Viewer','jordan@example.test',null from search_fixture union all select other_org,outsider,'Devon O''Neil','devon_oneil@example.test','Systems Engineer' from search_fixture;
insert into private.platform_owners(user_id) select owner from search_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select session,owner,now(),now() from search_fixture;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) select gen_random_uuid(),owner,'totp','verified',now(),now() from search_fixture;

select set_config('request.jwt.claims',jsonb_build_object('sub',staff,'aal','aal2')::text,true) from search_fixture;
set local role authenticated;
insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,title,description) select ticket,org,employee,staff,'Workstation network','Connection timeout 1234567890' from search_fixture;
insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) select org,ticket,staff,'reply'::public.ticket_message_kind,'Restart adapter' from search_fixture union all select org,ticket,staff,'internal_note','confidentialneedle' from search_fixture;
insert into public.knowledge_articles(organization_id,category,title,content,status) select org,'Network','Network troubleshooting','[{"type":"paragraph","text":"Restart adapter using screen menu"}]'::jsonb,'published' from search_fixture union all select org,'Network','Classifiedguide draft','[]'::jsonb,'draft' from search_fixture;
insert into public.departments(organization_id,name) select org,'FragmentDept' from search_fixture;

select pg_temp.check_universal_search((select count(*)=1 from public.search_tickets((select org from search_fixture),'workstat adapt')),'ticket terms combine partial title and public message');
select pg_temp.check_universal_search((select count(*)=1 from public.search_tickets((select org from search_fixture),'O''NEI 12345')),'ticket terms combine people and serial-like description fragments');
select pg_temp.check_universal_search((select count(*)=1 from public.search_tickets((select org from search_fixture),'confid')),'staff may match a partial internal note');
select pg_temp.check_universal_search((select count(*)=1 from public.search_tickets((select org from search_fixture),(select '#'||ticket_number from public.tickets where id=(select ticket from search_fixture)))),'exact ticket shortcut remains available');
select pg_temp.check_universal_search((select count(*)=1 from public.search_knowledge_articles((select org from search_fixture),'TROUBLE adapt')),'knowledge terms match partial title and body');
select pg_temp.check_universal_search((select count(*)=0 from public.search_knowledge_articles((select org from search_fixture),'trouble impossible')),'knowledge requires every term');
select pg_temp.check_universal_search((select count(*)=1 from public.search_members((select org from search_fixture),'syst O''NEI')),'people combine partial job title and punctuated name');
select pg_temp.check_universal_search((select count(*)=1 from public.search_members((select org from search_fixture),'_one')),'email underscores are literal');
select pg_temp.check_universal_search((select count(*)=0 from public.search_members((select other_org from search_fixture),'devon')),'people search cannot cross organizations');
select pg_temp.check_universal_search((select count(*)=1 from public.search_audit_events((select org from search_fixture),'fragm devon') where entity_type='departments'),'audit terms combine actor and partial item name');
select pg_temp.check_universal_search((select count(*)=0 from public.search_audit_events((select org from search_fixture),'confid')),'audit search excludes message contents');
select pg_temp.check_universal_search(private.search_patterns(E'  HP\nHP\t850 ') = array['%850%','%HP%'],'one bounded literal term parser is shared');
do $$begin
 begin perform public.platform_overview('universal');raise exception 'Tenant admin searched platform';exception when insufficient_privilege then null;end;
end$$;

select set_config('request.jwt.claims',jsonb_build_object('sub',employee,'aal','aal2')::text,true) from search_fixture;
select pg_temp.check_universal_search((select count(*)=1 from public.search_tickets((select org from search_fixture),'workstat adapt')),'employee sees own public matches');
select pg_temp.check_universal_search((select count(*)=0 from public.search_tickets((select org from search_fixture),'confid')),'partial internal-note search cannot leak to employees');
select pg_temp.check_universal_search((select count(*)=1 from public.search_knowledge_articles((select org from search_fixture),'trouble adapt')),'employee sees published partial knowledge matches');
select pg_temp.check_universal_search((select count(*)=0 from public.search_knowledge_articles((select org from search_fixture),'classif')),'partial draft match cannot leak');
select pg_temp.check_universal_search((select count(*)=0 from public.search_audit_events((select org from search_fixture),'fragm')),'employee cannot search staff audit records');

select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'aal','aal2')::text,true) from search_fixture;
select pg_temp.check_universal_search((select count(*)=0 from public.search_tickets((select org from search_fixture),'workstat')),'partial ticket search cannot cross organizations');
select pg_temp.check_universal_search((select count(*)=0 from public.search_knowledge_articles((select org from search_fixture),'trouble')),'partial knowledge search cannot cross organizations');
select pg_temp.check_universal_search((select count(*)=0 from public.search_audit_events((select org from search_fixture),'fragm')),'partial audit search cannot cross organizations');

select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'aal','aal2','session_id',session)::text,true) from search_fixture;
do $$declare report jsonb;begin
 report:=public.platform_overview('ERSAL needle',1,30);
 perform pg_temp.check_universal_search((report->>'matchingCount')::integer=1 and jsonb_array_length(report->'organizations')=1,'platform matches partial terms across name and slug with consistent counts');
 report:=public.platform_overview('universal %',1,30);
 perform pg_temp.check_universal_search((report->>'matchingCount')::integer=1,'platform percent is literal');
 report:=public.platform_overview('universal _',1,30);
 perform pg_temp.check_universal_search((report->>'matchingCount')::integer=0,'platform underscore is literal');
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'aal','aal1','session_id',session)::text,true) from search_fixture;
do $$begin
 begin perform public.platform_overview('universal');raise exception 'Owner searched without required MFA';exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
