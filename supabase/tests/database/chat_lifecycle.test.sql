begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000991','chat-worker-991@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000992','chat-employee-992@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000993','chat-outsider-993@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000991','Chat lifecycle check','chat-lifecycle-check-991');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000991','administrator'),
 ('20000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000992','end_user'),
 ('20000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000993','end_user');
insert into public.chat_conversations(id,organization_id,requester_id,topic) values
 ('40000000-0000-0000-0000-000000000991','20000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000992','Printer offline'),
 ('40000000-0000-0000-0000-000000000992','20000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000992','Unanswered request');
insert into public.chat_messages(organization_id,conversation_id,author_id,body,created_at) values
 ('20000000-0000-0000-0000-000000000991','40000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000991','Restart the printer',now()-interval '4 days'),
 ('20000000-0000-0000-0000-000000000991','40000000-0000-0000-0000-000000000992','10000000-0000-0000-0000-000000000992','Please help',now()-interval '4 days');
insert into public.chat_messages(organization_id,conversation_id,author_id,kind,body,created_at) values
 ('20000000-0000-0000-0000-000000000991','40000000-0000-0000-0000-000000000991','10000000-0000-0000-0000-000000000991','internal_note','Private vendor diagnosis',now()-interval '3 days');
select extensions.ok(has_function_privilege('service_role','public.process_idle_chats(integer)','EXECUTE'),'service worker can process idle chats');
select extensions.ok(not has_function_privilege('authenticated','public.process_idle_chats(integer)','EXECUTE'),'members cannot process idle chats');
select extensions.ok(not has_column_privilege('authenticated','public.chat_conversations','closure_summary','INSERT') and not has_column_privilege('authenticated','public.chat_conversations','closure_summary','UPDATE'),'members cannot forge summaries');
select extensions.ok(not has_column_privilege('authenticated','public.chat_conversations','created_at','INSERT'),'creation times remain server owned');
alter table public.chat_conversations disable trigger chat_prepare_change;
update public.chat_conversations set updated_at=now()-interval '4 days' where organization_id='20000000-0000-0000-0000-000000000991';
alter table public.chat_conversations enable trigger chat_prepare_change;
select public.process_idle_chats();
select extensions.ok((select idle_warning_at is not null and idle_warning_due_at>now() from public.chat_conversations where id='40000000-0000-0000-0000-000000000991'),'old answered chat gets a fresh grace period');
select extensions.is((select status::text from public.chat_conversations where id='40000000-0000-0000-0000-000000000991'),'open','warning does not close immediately');
select extensions.is((select status::text from public.chat_conversations where id='40000000-0000-0000-0000-000000000992'),'open','unanswered chat stays open');
select extensions.is((select count(*)::integer from public.notifications where conversation_id='40000000-0000-0000-0000-000000000991' and kind='chat_idle_warning'),1,'one warning notification');
select extensions.is((select count(*)::integer from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.conversation_id='40000000-0000-0000-0000-000000000991' and n.kind='chat_idle_warning'),1,'warning uses existing email queue');
select public.process_idle_chats();
select extensions.is((select count(*)::integer from public.notifications where conversation_id='40000000-0000-0000-0000-000000000991' and kind='chat_idle_warning'),1,'retries do not duplicate warnings');
alter table public.chat_conversations disable trigger chat_prepare_change;
update public.chat_conversations set updated_at=now()-interval '4 days',idle_warning_at=now()-interval '1 day',idle_warning_due_at=now()-interval '1 hour' where id='40000000-0000-0000-0000-000000000991';
alter table public.chat_conversations enable trigger chat_prepare_change;
select public.process_idle_chats();
select extensions.is((select status::text from public.chat_conversations where id='40000000-0000-0000-0000-000000000991'),'closed','answered chat closes after the warning grace period');
select extensions.ok((select closure_summary like '%Restart the printer%' and closure_summary not like '%Private vendor%' from public.chat_conversations where id='40000000-0000-0000-0000-000000000991'),'summary uses public content only');
select extensions.is((select count(*)::integer from public.notifications where conversation_id='40000000-0000-0000-0000-000000000991' and kind='chat_auto_closed'),1,'one closure notification');
select extensions.ok(exists(select 1 from public.audit_events where entity_id='40000000-0000-0000-0000-000000000991' and entity_type='chat_conversations' and changes::text like '%closed%'),'closure is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000992","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.chat_conversations where id='40000000-0000-0000-0000-000000000991' and closure_summary is not null),1,'requester can read own summary');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000993","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::integer from public.chat_conversations where id='40000000-0000-0000-0000-000000000991'),0,'another employee cannot read the chat');
reset role;
select * from extensions.finish();
rollback;
