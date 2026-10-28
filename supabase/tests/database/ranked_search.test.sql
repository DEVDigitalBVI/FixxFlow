begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000781','search-admin-781@example.invalid'),
 ('10000000-0000-0000-0000-000000000782','search-member-782@example.invalid'),
 ('10000000-0000-0000-0000-000000000783','search-foreign-783@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000781','Search check A','search-check-a-781'),
 ('20000000-0000-0000-0000-000000000782','Search check B','search-check-b-782');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000781','10000000-0000-0000-0000-000000000781','administrator'),
 ('20000000-0000-0000-0000-000000000781','10000000-0000-0000-0000-000000000782','end_user'),
 ('20000000-0000-0000-0000-000000000782','10000000-0000-0000-0000-000000000783','administrator');
insert into public.profiles(organization_id,user_id,display_name) values
 ('20000000-0000-0000-0000-000000000781','10000000-0000-0000-0000-000000000782','Printerperson');
insert into public.library_articles(id,title,summary,category,status,audience,content) values
 ('60000000-0000-0000-0000-000000000781','Printer','Recovery guide','Hardware','published','employees','[{"type":"paragraph","text":"Steps"}]');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000781","role":"authenticated","aal":"aal1"}',true);
insert into public.tickets(id,organization_id,requester_id,title,description) values
 ('70000000-0000-0000-0000-000000000781','20000000-0000-0000-0000-000000000781','10000000-0000-0000-0000-000000000782','Printer recovery','Paper jam');
insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values
 ('20000000-0000-0000-0000-000000000781','70000000-0000-0000-0000-000000000781','10000000-0000-0000-0000-000000000781','internal_note','unicornsecret781');
select extensions.is((select id::text from public.search_workspace('20000000-0000-0000-0000-000000000781','printer') limit 1),'60000000-0000-0000-0000-000000000781','exact article title ranks before ticket prefix');
select extensions.ok(exists(select 1 from public.search_workspace('20000000-0000-0000-0000-000000000781','pritner') where kind='ticket' and approximate),'transposition finds ticket with explicit approximate flag');
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','printre zebra')),0,'all query terms are required');
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','#'||(select ticket_number from public.tickets where id='70000000-0000-0000-0000-000000000781'))),1,'exact ticket number returns one result');
select extensions.ok(exists(select 1 from public.search_workspace('20000000-0000-0000-0000-000000000781','printerperson') where kind='person'),'staff can search people');
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000782','printer')),0,'organization argument cannot bypass membership');
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','%')),0,'wildcards are literal');
select extensions.ok(exists(select 1 from public.search_workspace('20000000-0000-0000-0000-000000000781','unicornsecret781') where kind='ticket'),'staff can search readable internal notes');
select public.set_library_article_hidden('20000000-0000-0000-0000-000000000781','60000000-0000-0000-0000-000000000781',true);
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','pritner') where id='60000000-0000-0000-0000-000000000781'),0,'hidden guides excluded from typo matches');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000782","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','printerperson') where kind='person'),0,'employee cannot search people');
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000781','unicornsecret781')),0,'private note cannot influence employee results');
select extensions.ok(exists(select 1 from public.search_workspace('20000000-0000-0000-0000-000000000781','pritner') where id='70000000-0000-0000-0000-000000000781'),'employee can find own ticket by typo');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000783","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.search_workspace('20000000-0000-0000-0000-000000000782','pritner') where id='70000000-0000-0000-0000-000000000781'),0,'foreign employee ticket remains isolated');
reset role;
select * from extensions.finish();
rollback;
