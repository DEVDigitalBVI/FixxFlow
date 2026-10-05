-- Run on a migrated local database: supabase db query --local --file supabase/tests/sla-regression.sql
-- Every fixture and assertion rolls back. This is a plain SQL regression test (not pgTAP).
begin;
create function pg_temp.assert_sla(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'SLA assertion failed: %', message; end if; end;
$$;

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
select pg_temp.assert_sla(
  (select bool_and(response_sla_due_at = created_at + make_interval(mins => case priority when 'critical' then 15 when 'high' then 60 when 'normal' then 240 when 'low' then 480 end)
    and resolution_sla_due_at = created_at + make_interval(mins => case priority when 'critical' then 240 when 'high' then 480 when 'normal' then 1440 when 'low' then 2880 end))
   from public.tickets where organization_id = '20000000-0000-0000-0000-000000000031'), 'all four response and resolution targets');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
insert into public.tickets (id, organization_id, requester_id, title, description, priority)
values ('30000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'Lifecycle', 'Test', 'normal');
select pg_temp.assert_sla((select response_sla_due_at = created_at + interval '4 hours' and resolution_sla_due_at = created_at + interval '24 hours' from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'server computes deadlines');
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'reply', 'Requester follow-up');
select pg_temp.assert_sla((select first_response_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'requester reply does not satisfy response');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000032","role":"authenticated"}', true);
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032', 'internal_note', 'IT note');
select pg_temp.assert_sla((select first_response_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'internal note does not satisfy response');
update public.tickets set priority = 'critical' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select response_sla_due_at = created_at + interval '15 minutes' and resolution_sla_due_at = created_at + interval '4 hours' from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'priority changes pending deadlines from creation');
insert into public.ticket_messages (organization_id, ticket_id, author_id, kind, body)
values ('20000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000032', 'reply', 'Public staff response');
select pg_temp.assert_sla((select first_response_at is not null and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'public staff response completes response and advances next deadline');
update public.tickets set priority = 'high', status = 'on_hold' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select response_sla_due_at = created_at + interval '15 minutes' and resolution_sla_due_at = created_at + interval '8 hours' and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'completed response target freezes and on-hold does not pause resolution');
update public.tickets set status = 'resolved' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select resolved_at is not null and sla_next_due_at is null from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'resolution stops queue SLA clock');
update public.tickets set status = 'closed', priority = 'low' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select resolved_at is not null and closed_at is not null and resolution_sla_due_at = created_at + interval '8 hours' from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'closing preserves resolution timestamp and completed target');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000031","role":"authenticated"}', true);
update public.tickets set status = 'open' where id = '30000000-0000-0000-0000-000000000031';
select pg_temp.assert_sla((select status = 'open' and resolved_at is null and closed_at is null and first_response_at is not null and resolution_sla_due_at = created_at + interval '8 hours' and sla_next_due_at = resolution_sla_due_at from public.tickets where id = '30000000-0000-0000-0000-000000000031'), 'employee reopening works and resumes the original deadline');

reset role;
rollback;
