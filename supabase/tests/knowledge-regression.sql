begin;
create function pg_temp.check_knowledge(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Knowledge assertion failed: %',message; end if; end $$;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000091','kb-worker@example.test'),
 ('10000000-0000-0000-0000-000000000092','kb-reader@example.test'),
 ('10000000-0000-0000-0000-000000000093','kb-outsider@example.test');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000091','Knowledge fixtures','knowledge-fixtures'),
 ('20000000-0000-0000-0000-000000000092','Other knowledge','other-knowledge');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091','technician'),
 ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000092','end_user'),
 ('20000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000093','end_user');
select pg_temp.check_knowledge((select count(*)=0 from public.knowledge_articles where organization_id='20000000-0000-0000-0000-000000000091'),'new organizations start without sample articles');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000091","aal":"aal1"}',true);
insert into public.knowledge_articles(id,organization_id,category,title,content) values
 ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Network','VPN troubleshooting','[{"type":"heading","text":"VPN error 809"},{"type":"paragraph","text":"Check firewall settings"}]');
select pg_temp.check_knowledge((select author_id=auth.uid() and revision=1 from public.knowledge_articles where id='30000000-0000-0000-0000-000000000091'),'server-derived author and revision');
insert into public.knowledge_attachments(id,organization_id,article_id,storage_path,file_name,content_type,size_bytes) values
 ('40000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091/30000000-0000-0000-0000-000000000091/image.png','image.png','image/png',100);
insert into storage.objects(bucket_id,name) values ('knowledge-assets','20000000-0000-0000-0000-000000000091/30000000-0000-0000-0000-000000000091/image.png');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000092","aal":"aal1"}',true);
select pg_temp.check_knowledge((select count(*)=0 from public.search_knowledge_articles('20000000-0000-0000-0000-000000000091','VPN error 809')),'draft excluded from employee search');
select pg_temp.check_knowledge((select count(*)=0 from public.knowledge_attachments),'draft attachments hidden');
select pg_temp.check_knowledge((select count(*)=0 from storage.objects where bucket_id='knowledge-assets'),'draft files hidden');
do $$ begin
 begin
 insert into public.knowledge_articles(organization_id,category,title) values('20000000-0000-0000-0000-000000000091','Network','Unauthorized article');
 raise exception 'Employee article insert allowed'; exception when insufficient_privilege then null; end;
 begin
 perform public.record_article_view('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091');
 raise exception 'Draft view allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000091","aal":"aal1"}',true);
update public.knowledge_articles set status='published' where id='30000000-0000-0000-0000-000000000091' and revision=1;
select pg_temp.check_knowledge((select revision=2 from public.knowledge_articles where id='30000000-0000-0000-0000-000000000091'),'revision incremented');
with changed as(update public.knowledge_articles set title='Stale edit' where id='30000000-0000-0000-0000-000000000091' and revision=1 returning id)
select pg_temp.check_knowledge((select count(*)=0 from changed),'stale edit rejected');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000092","aal":"aal1"}',true);
select pg_temp.check_knowledge((select count(*)=1 from public.search_knowledge_articles('20000000-0000-0000-0000-000000000091','VPN error 809')),'published content searchable');
select pg_temp.check_knowledge((select count(*)=1 from storage.objects where bucket_id='knowledge-assets'),'published asset readable');
select public.record_article_view('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091');
select public.record_article_view('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091');
select public.rate_article('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091',true);
select public.rate_article('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091',false);
select pg_temp.check_knowledge((select count(*)=1 and bool_and(not helpful) from public.knowledge_article_feedback),'vote changed without duplication');
select pg_temp.check_knowledge((select count(*)=0 from public.knowledge_article_views),'employee cannot enumerate readership');
select pg_temp.check_knowledge(not has_column_privilege('authenticated','public.knowledge_article_views','user_id','INSERT') and not has_column_privilege('authenticated','public.knowledge_article_views','viewed_on','INSERT'),'reader identity and date cannot be forged');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000093","aal":"aal1"}',true);
select pg_temp.check_knowledge((select count(*)=0 from public.search_knowledge_articles('20000000-0000-0000-0000-000000000091','VPN')),'cross-organization search blocked');
select pg_temp.check_knowledge((select count(*)=0 from storage.objects where bucket_id='knowledge-assets'),'cross-organization storage blocked');
reset role;
select pg_temp.check_knowledge((select count(*)=1 from public.knowledge_article_views),'daily reader view deduplicated');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'10000000-0000-0000-0000-000000000092','totp','verified',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000092","aal":"aal1"}',true);
select pg_temp.check_knowledge((select count(*)=0 from public.knowledge_articles),'MFA blocks article access');
reset role;
rollback;
