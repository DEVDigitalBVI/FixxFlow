-- Test-only token issuer. Never deploy or use in application code.
create or replace function pg_temp.set_test_session(claims text, local_setting boolean) returns text
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=claims::jsonb; actor uuid; session uuid;
begin
 if payload->>'sub' is not null and not(payload ? 'session_id') then
  actor:=(payload->>'sub')::uuid;
  if exists(select 1 from auth.users where id=actor) then
   select id into session from auth.sessions where user_id=actor and (not_after is null or not_after>now()) limit 1;
   if session is null then
    session:=gen_random_uuid();
    insert into auth.sessions(id,user_id,created_at) values(session,actor,now());
   end if;
   payload:=payload||jsonb_build_object('session_id',session);
  end if;
 end if;
 return set_config('request.jwt.claims',payload::text,local_setting);
end $$;

-- Run on a migrated local database: supabase db query --local --file supabase/tests/sla-regression.sql
-- Every fixture and assertion rolls back. This is a plain SQL regression test (not pgTAP).
begin;
create function pg_temp.assert_sla(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'SLA assertion failed: %', message; end if; end;
$$;

create function pg_temp.deadline(a timestamptz,p public.ticket_priority,r boolean) returns timestamptz language sql security definer as 'select private.ticket_sla_deadline(a,p,r,''UTC'')';

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000031', 'sla-employee@example.test'),
  ('10000000-0000-0000-0000-000000000032', 'sla-technician@example.test');
insert into public.organizations (id, name, slug) values
  ('20000000-0000-0000-0000-000000000031', 'SLA test', 'sla-test');
insert into public.organization_memberships (organization_id, user_id, role, status) values
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'end_user', 'active'),
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032', 'technician', 'active');
insert into public.tickets (organization_id, requester_id, title, description, priority, created_at)
select '20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', priority::text, 'Test', priority, '2026-09-24T08:00:00Z'
from unnest(enum_range(null::public.ticket_priority)) priority;
select pg_temp.assert_sla((select bool_and(response_sla_due_at=pg_temp.deadline(created_at,priority,true) and resolution_sla_due_at=pg_temp.deadline(created_at,priority,false)) from public.tickets where organization_id='20000000-0000-0000-0000-000000000031'),'all four support-hour targets');

set local role authenticated;
select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
insert into public.tickets (id, organization_id, requester_id, title, description, priority)
values ('30000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'Lifecycle', 'Test', 'normal');
select pg_temp.assert_sla((select response_sla_due_at = pg_temp.deadline(created_at,'normal',true) and resolution_sla_due_at = pg_temp.deadline(created_at,'normal',false) from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'server computes deadlines');
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'reply', 'Requester follow-up');
select pg_temp.assert_sla((select first_response_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'requester reply does not satisfy response');

select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000032","role":"authenticated"}', true);
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032', 'internal_note', 'IT note');
select pg_temp.assert_sla((select first_response_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'internal note does not satisfy response');
update public.tickets set priority = 'critical' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select response_sla_due_at = pg_temp.deadline(created_at,'critical',true) and resolution_sla_due_at = pg_temp.deadline(created_at,'critical',false) from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'priority changes pending deadlines from creation');
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032', 'reply', 'Public staff response');
select pg_temp.assert_sla((select first_response_at is not null and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'public staff response completes response and advances next deadline');
update public.tickets set priority = 'high', status = 'on_hold' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select response_sla_due_at = pg_temp.deadline(created_at,'critical',true) and resolution_sla_due_at = pg_temp.deadline(created_at,'high',false) and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'completed response target freezes and on-hold does not pause resolution');
update public.tickets set status = 'resolved' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select resolved_at is not null and sla_next_due_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'resolution stops queue SLA clock');
update public.tickets set status = 'closed', priority = 'low' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select resolved_at is not null and closed_at is not null and resolution_sla_due_at = pg_temp.deadline(created_at,'high',false) from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'closing preserves resolution timestamp and completed target');

select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
select public.reopen_ticket('30000000-0000-0000-0000-000000000031',(select revision from public.tickets where id='30000000-0000-0000-0000-000000000031'),'The issue is not resolved.',gen_random_uuid());
select pg_temp.assert_sla((select status = 'open' and resolved_at is null and closed_at is null and first_response_at is not null and resolution_sla_due_at = pg_temp.deadline(created_at,'high',false) and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'employee reopening works and resumes the original deadline');

reset role;
rollback;
