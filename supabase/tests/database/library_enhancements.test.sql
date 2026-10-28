begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000881','library-admin-881@example.invalid'),
 ('10000000-0000-0000-0000-000000000882','library-member-882@example.invalid'),
 ('10000000-0000-0000-0000-000000000883','library-foreign-883@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000881','Library check A','library-check-a-881'),
 ('20000000-0000-0000-0000-000000000882','Library check B','library-check-b-882');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000881','10000000-0000-0000-0000-000000000881','administrator'),
 ('20000000-0000-0000-0000-000000000881','10000000-0000-0000-0000-000000000882','end_user'),
 ('20000000-0000-0000-0000-000000000882','10000000-0000-0000-0000-000000000883','administrator');
insert into public.library_articles(id,title,summary,category,status,audience,content) values
 ('60000000-0000-0000-0000-000000000881','Canarykoala VPN guide','Recover your connection','Network','published','employees','[{"type":"paragraph","text":"Reconnect safely."}]');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000882","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.library_articles where id='60000000-0000-0000-0000-000000000881'),1,'employee reads permitted shared guide');
select extensions.is((select count(*)::integer from public.suggest_knowledge_articles('20000000-0000-0000-0000-000000000881','Canarykoala')),1,'subject suggestions include the permitted guide');
select extensions.lives_ok($$select public.record_library_article_view('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881')$$,'records shared guide view');
select extensions.lives_ok($$select public.record_library_article_view('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881')$$,'repeated daily view is idempotent');
select extensions.lives_ok($$select public.rate_library_article('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',true); select public.rate_library_article('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',false)$$,'vote can change');
select extensions.is((select helpful from public.library_article_feedback where article_id='60000000-0000-0000-0000-000000000881'),false,'latest vote replaces previous choice');
select extensions.throws_ok($$select public.record_library_article_view('20000000-0000-0000-0000-000000000882','60000000-0000-0000-0000-000000000881')$$,'42501',null,'cannot record usage for another organization');
select extensions.throws_ok($$select public.set_library_article_hidden('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',true)$$,'42501',null,'employee cannot hide shared guides');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000881","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.library_article_views where article_id='60000000-0000-0000-0000-000000000881'),1,'staff sees one daily view');
select extensions.throws_ok($$select * from public.library_article_usage('60000000-0000-0000-0000-000000000881')$$,'42501',null,'workspace administrator cannot read platform-wide usage');
select extensions.lives_ok($$select public.set_library_article_hidden('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',true)$$,'administrator hides the guide');
select extensions.lives_ok($$select public.set_library_article_hidden('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',true)$$,'repeated hide is idempotent');
select extensions.is((select count(*)::integer from public.library_articles where id='60000000-0000-0000-0000-000000000881'),0,'hidden guide is excluded from normal reads');
select extensions.is((select hidden from public.workspace_library_choices('20000000-0000-0000-0000-000000000881','Canarykoala')),true,'administrator can find the hidden guide for restoration');
select extensions.is((select count(*)::integer from public.audit_events where entity_type='library_visibility' and entity_id='60000000-0000-0000-0000-000000000881'),1,'only the actual hide is audited');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000882","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.suggest_knowledge_articles('20000000-0000-0000-0000-000000000881','Canarykoala')),0,'hidden guide is excluded from suggestions');
select extensions.throws_ok($$select public.rate_library_article('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',true)$$,'42501',null,'hidden guide cannot collect new feedback');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000883","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.library_articles where id='60000000-0000-0000-0000-000000000881'),1,'another workspace still sees the shared source');
select extensions.is((select count(*)::integer from public.library_article_feedback where article_id='60000000-0000-0000-0000-000000000881'),0,'another workspace cannot read member feedback');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000881","role":"authenticated","aal":"aal1"}',true);
select extensions.lives_ok($$select public.set_library_article_hidden('20000000-0000-0000-0000-000000000881','60000000-0000-0000-0000-000000000881',false)$$,'administrator restores the guide');
reset role;
select * from extensions.finish();
rollback;
