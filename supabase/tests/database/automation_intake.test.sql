begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000861','intake-admin-861@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000862','intake-employee-862@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000863','intake-foreign-863@example.invalid',now());
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000861','Intake A','intake-a-861'),
 ('20000000-0000-0000-0000-000000000862','Intake B','intake-b-862');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000861','10000000-0000-0000-0000-000000000861','administrator'),
 ('20000000-0000-0000-0000-000000000861','10000000-0000-0000-0000-000000000862','end_user'),
 ('20000000-0000-0000-0000-000000000862','10000000-0000-0000-0000-000000000863','administrator');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000862","role":"authenticated","aal":"aal1"}',true);
insert into public.chat_conversations(id,organization_id,requester_id,topic) values
 ('30000000-0000-0000-0000-000000000861','20000000-0000-0000-0000-000000000861','10000000-0000-0000-0000-000000000862','Intake conversation');
select extensions.throws_ok($$select public.convert_chat_to_ticket('30000000-0000-0000-0000-000000000861')$$,'42501','Chat not found or access denied','employee cannot convert');
select extensions.ok(not has_function_privilege('authenticated','private.record_ticket_intake(uuid,uuid,text)','EXECUTE'),'clients cannot forge intake');
select extensions.ok(not has_function_privilege('authenticated','private.reply_with_suggested_articles()','EXECUTE'),'clients cannot send automation replies');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000863","role":"authenticated","aal":"aal1"}',true);
select extensions.throws_ok($$select public.convert_chat_to_ticket('30000000-0000-0000-0000-000000000861')$$,'42501','Chat not found or access denied','foreign staff cannot convert');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000861","role":"authenticated","aal":"aal1"}',true);
select extensions.lives_ok($$select public.convert_chat_to_ticket('30000000-0000-0000-0000-000000000861')$$,'staff can convert');
select extensions.lives_ok($$select public.convert_chat_to_ticket('30000000-0000-0000-0000-000000000861')$$,'repeated conversion returns existing ticket');
reset role;
select extensions.is((select count(*)::int from private.domain_events where organization_id='20000000-0000-0000-0000-000000000861' and event_type='ticket.created_from_chat'),1,'one chat intake event');
select extensions.ok((select bool_and(private.automation_event_compatible(e)) from private.domain_events e where organization_id='20000000-0000-0000-0000-000000000861' and event_type='ticket.created_from_chat'),'source event accepted by worker');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.accept_inbound_email('native-intake-email','intake-a-861','intake-employee-862@example.invalid','Native email intake','Request',true,0);
select public.accept_inbound_email('native-intake-email','intake-a-861','intake-employee-862@example.invalid','Native email intake','Request',true,0);
select public.accept_inbound_email('native-intake-forged','intake-a-861','intake-employee-862@example.invalid','Forged sender','Request',false,0);
reset role;
select extensions.is((select count(*)::int from private.domain_events where organization_id='20000000-0000-0000-0000-000000000861' and event_type='ticket.created_from_email'),1,'retry and rejected email add no events');
select extensions.ok((select bool_and(before_snapshot is null and not after_snapshot?'description') from private.domain_events where organization_id='20000000-0000-0000-0000-000000000861' and event_type in ('ticket.created_from_chat','ticket.created_from_email')),'intake snapshots omit message bodies');
select extensions.ok(not has_table_privilege('authenticated','private.ticket_article_replies','INSERT'),'cannot forge article deduplication receipts');
select extensions.ok(private.automation_definition_catalog()#>'{actions,suggest_articles,triggerTypes}' @> '["ticket.created_from_email","ticket.created_from_chat"]'::jsonb,'article replies supported on both intake channels');
select * from extensions.finish();
rollback;
