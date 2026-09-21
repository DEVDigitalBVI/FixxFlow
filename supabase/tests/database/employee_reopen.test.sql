begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000011', 'employee@example.test');
insert into public.organizations (id, name, slug) values
  ('20000000-0000-0000-0000-000000000011', 'Employee Reopen', 'employee-reopen');
insert into public.organization_memberships (organization_id, user_id, role, status)
values ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'end_user', 'active');
insert into public.tickets (id, organization_id, requester_id, title, description, status)
values
  ('30000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'Resolved request', 'Details', 'resolved'),
  ('30000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'Closed request', 'Details', 'closed'),
  ('30000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'New request', 'Details', 'new');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal1"}', true);
select extensions.lives_ok($$update public.tickets set status = 'open' where id = '30000000-0000-0000-0000-000000000011'$$, 'requester can reopen resolved request');
select extensions.is((select status::text from public.tickets where id = '30000000-0000-0000-0000-000000000011'), 'open', 'request is open after reopening');
select extensions.is((with changed as (update public.tickets set status = 'open' where id = '30000000-0000-0000-0000-000000000013' returning id) select count(*)::integer from changed), 0, 'requester cannot update a new request');
select extensions.throws_ok($$update public.tickets set status = 'open', title = 'Changed' where id = '30000000-0000-0000-0000-000000000012'$$, 'P0001', 'Only a resolved or closed request may be reopened', 'reopening cannot change other fields');

reset role;
select * from extensions.finish();
rollback;
