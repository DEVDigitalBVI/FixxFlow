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
    insert into auth.sessions(id,user_id) values(session,actor);
   end if;
   payload:=payload||jsonb_build_object('session_id',session);
  end if;
 end if;
 return set_config('request.jwt.claims',payload::text,local_setting);
end $$;

begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

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
select pg_temp.set_test_session( '{"sub":"10000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal1"}', true);
select extensions.lives_ok($$select public.reopen_ticket('30000000-0000-0000-0000-000000000011',1,'The same issue is still happening.','90000000-0000-0000-0000-000000000011')$$, 'requester can reopen resolved request');
select extensions.is((select status::text from public.tickets where id = '30000000-0000-0000-0000-000000000011'), 'open', 'request is open after reopening');
with changed as (update public.tickets set status = 'open' where id = '30000000-0000-0000-0000-000000000013' returning id)
select extensions.is((select count(*)::integer from changed), 0, 'requester cannot update a new request');
select extensions.throws_ok($$update public.tickets set status = 'open', title = 'Changed' where id = '30000000-0000-0000-0000-000000000012'$$, 'P0001', 'Only a resolved or closed request may be reopened', 'reopening cannot change other fields');

select extensions.lives_ok($$select public.reopen_ticket('30000000-0000-0000-0000-000000000012',1,'The problem returned after closure.','90000000-0000-0000-0000-000000000012')$$, 'requester can reopen a closed request with a reason');

reset role;
select * from extensions.finish();
rollback;
