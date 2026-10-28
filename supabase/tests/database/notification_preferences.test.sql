begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000871','notification-admin-871@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000872','notification-employee-872@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000873','notification-foreign-873@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000871','Notification A','notification-a-871'),
 ('20000000-0000-0000-0000-000000000872','Notification B','notification-b-872');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000871','10000000-0000-0000-0000-000000000871','administrator'),
 ('20000000-0000-0000-0000-000000000871','10000000-0000-0000-0000-000000000872','end_user'),
 ('20000000-0000-0000-0000-000000000872','10000000-0000-0000-0000-000000000873','administrator');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000872","role":"authenticated","aal":"aal1"}',true);
select extensions.is(public.save_notification_preferences('20000000-0000-0000-0000-000000000871',0,'{"email_mode":"daily","timezone":"UTC","digest_hour":0,"quiet_enabled":false,"quiet_start":"22:00","quiet_end":"07:00","urgent_immediate":false}'),1::bigint,'employee saves personal preferences');
select extensions.ok((select digest_not_before>now() from public.notification_preferences),'first summary scheduled in the future');
select extensions.throws_ok($$select public.save_notification_preferences('20000000-0000-0000-0000-000000000871',0,'{"email_mode":"daily","timezone":"UTC","digest_hour":0,"quiet_enabled":false,"quiet_start":"22:00","quiet_end":"07:00","urgent_immediate":false}')$$,'40001','Preferences changed; reload before saving','stale settings rejected');
select extensions.ok(not has_function_privilege('authenticated','public.claim_notification_digests(integer)','EXECUTE'),'members cannot claim digests');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000873","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::int from public.notification_preferences),0,'foreign staff cannot read preferences');
select extensions.throws_ok($$select public.save_notification_preferences('20000000-0000-0000-0000-000000000871',0,'{}')$$,'42501','Active member required','foreign staff cannot change preferences');
reset role;
select extensions.ok(private.notification_quiet(jsonb_populate_record(null::public.notification_preferences,'{"quiet_enabled":true,"quiet_start":"22:00","quiet_end":"07:00","timezone":"America/New_York"}'),'2026-11-01T06:30:00Z'),'quiet hours survive fall DST fold');
select extensions.is(private.notification_digest_slot(jsonb_populate_record(null::public.notification_preferences,'{"digest_hour":23,"timezone":"America/New_York"}'),'2026-10-28T11:00:00Z'),'2026-10-28T03:00:00Z'::timestamptz,'morning release uses yesterday evening summary slot');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000871","role":"authenticated","aal":"aal1"}',true);
insert into public.tickets(id,organization_id,requester_id,title,description) values
 ('30000000-0000-0000-0000-000000000871','20000000-0000-0000-0000-000000000871','10000000-0000-0000-0000-000000000872','Native notification check','Description');
select private.enqueue_notification('20000000-0000-0000-0000-000000000871','10000000-0000-0000-0000-000000000872',null,'30000000-0000-0000-0000-000000000871',null,'ticket_response','Native summary update',false,'native-summary-871');
-- Clock fixture only, with validation triggers still enabled.
update public.notification_preferences set digest_not_before=now()-interval '2 days';
update public.notifications set created_at=now()-interval '1 day' where event_key='native-summary-871';
update private.notification_email_outbox set available_at=now()-interval '1 minute' where notification_id in(select id from public.notifications where event_key='native-summary-871');
select extensions.is((select private.notification_email_mode(n) from public.notifications n where event_key='native-summary-871'),'digest','daily mode selects digest delivery');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table claimed_digest as select * from public.claim_notification_digests(3) where recipient_email='notification-employee-872@example.invalid';
select extensions.is((select count(*)::int from claimed_digest),1,'digest claimed once');
select extensions.is((select total from claimed_digest),1,'one update captured');
select extensions.is((select count(*)::int from public.claim_notification_digests(3) where recipient_email='notification-employee-872@example.invalid'),0,'lease prevents overlapping delivery');
select extensions.ok((select public.finish_notification_digest(digest_id,lease_token,'native-provider',false) from claimed_digest),'delivery acknowledged with current lease');
reset role;
select extensions.is((select count(*)::int from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.event_key='native-summary-871' and q.status='sent'),1,'member rows marked delivered with batch');
select * from extensions.finish();
rollback;
