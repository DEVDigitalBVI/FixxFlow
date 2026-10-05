begin;
create function pg_temp.check_notification(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Notification assertion failed: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000061','worker@example.test',now()),
 ('10000000-0000-0000-0000-000000000062','employee@example.test',now());
insert into public.organizations(id,name,slug) values ('20000000-0000-0000-0000-000000000061','Notifications','notification-fixtures');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','administrator'),
 ('20000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','end_user');
insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,title,description) values
 ('30000000-0000-0000-0000-000000000061','20000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','10000000-0000-0000-0000-000000000061','Notification fixture','Test');
select pg_temp.check_notification((select count(*)=1 from public.notifications where kind='ticket_assigned'),'assignment alert');
insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values
 ('20000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','internal_note','Private content');
select pg_temp.check_notification((select count(*)=1 from public.notifications),'internal notes stay silent');
insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values
 ('20000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','reply','Public one'),
 ('20000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','reply','Public two');
select pg_temp.check_notification((select count(*)=2 from public.notifications where kind='ticket_response'),'both replies recorded');
select pg_temp.check_notification((select count(*)=2 from private.notification_email_outbox),'reply emails coalesced');
update public.tickets set status='resolved' where id='30000000-0000-0000-0000-000000000061';
update public.tickets set status='closed' where id='30000000-0000-0000-0000-000000000061';
select pg_temp.check_notification((select count(*)=2 from public.notifications where kind='ticket_resolved'),'resolve then close does not double notify');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000062","aal":"aal1"}',true);
select pg_temp.check_notification((select count(*)=3 from public.notifications),'employee sees only own alerts');
select pg_temp.check_notification(not has_function_privilege('authenticated','public.claim_notification_emails(integer)','EXECUTE'),'email queue service only');
select pg_temp.check_notification(not has_column_privilege('authenticated','public.notifications','title','UPDATE'),'notification content immutable');
update public.notifications set read_at=now();
reset role;
select pg_temp.check_notification((select count(*)=3 from public.notifications where read_at is not null),'mark read cannot change another recipient');
update private.notification_email_outbox set available_at=now();
create temporary table claimed as select * from public.claim_notification_emails(20);
select pg_temp.check_notification((select count(*)=2 from claimed),'read notifications skipped');
select pg_temp.check_notification((select count(*)=0 from public.claim_notification_emails(20)),'active leases cannot be claimed twice');
select pg_temp.check_notification(not public.finish_notification_email((select notification_id from claimed limit 1),gen_random_uuid(),'fake',null),'incorrect lease cannot acknowledge');
select public.finish_notification_email(notification_id,lease_token,'mock-provider-id',null) from claimed;
select pg_temp.check_notification((select count(*)=2 from private.notification_email_outbox where status='sent'),'delivery acknowledgement');
update public.tickets set status='open' where id='30000000-0000-0000-0000-000000000061';
select pg_temp.check_notification((select count(*)=1 from public.notifications where kind='ticket_reopened'),'reopen suppresses actor notification');
select set_config('request.jwt.claims','{}',true);
update public.tickets set assigned_technician_id=null where id='30000000-0000-0000-0000-000000000061';
select pg_temp.check_notification((select count(*)=1 from public.notifications where kind='ticket_reassigned'),'former assignee notified');
insert into public.ticket_messages(organization_id,ticket_id,author_id,body) values
 ('20000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','Requester follow-up');
select pg_temp.check_notification((select count(*)=1 from public.notifications where kind='user_replied'),'unassigned requester reply reaches staff');
insert into public.chat_conversations(id,organization_id,requester_id,topic) values
 ('40000000-0000-0000-0000-000000000061','20000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','Help with chat');
insert into public.chat_messages(organization_id,conversation_id,author_id,body) values
 ('20000000-0000-0000-0000-000000000061','40000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','Initial chat');
select pg_temp.check_notification((select count(*)=1 from public.notifications where conversation_id is not null),'first chat message does not double notify');
insert into public.chat_messages(organization_id,conversation_id,author_id,body,kind) values
 ('20000000-0000-0000-0000-000000000061','40000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','Internal diagnosis','internal_note'),
 ('20000000-0000-0000-0000-000000000061','40000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000061','Public response','message');
select pg_temp.check_notification((select count(*)=2 from public.notifications where conversation_id is not null),'chat notes silent and public responses delivered');
insert into public.tickets(id,organization_id,requester_id,title,description,priority,created_at) values
 ('30000000-0000-0000-0000-000000000062','20000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000062','SLA fixture','Test','critical',now()-interval '13 minutes');
select public.enqueue_sla_notifications();
select public.enqueue_sla_notifications();
select pg_temp.check_notification((select count(*)=1 from public.notifications where kind='sla_approaching'),'SLA warning emitted once per objective deadline');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values (gen_random_uuid(),'10000000-0000-0000-0000-000000000062','totp','verified',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000062","aal":"aal1"}',true);
select pg_temp.check_notification((select count(*)=0 from public.notifications),'enrolled low-assurance user cannot read notifications');
reset role;
rollback;
