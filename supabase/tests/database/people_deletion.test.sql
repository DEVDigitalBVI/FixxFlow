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

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000851','delete-admin@example.invalid'),
 ('10000000-0000-4000-8000-000000000852','delete-tech@example.invalid'),
 ('10000000-0000-4000-8000-000000000853','delete-employee@example.invalid'),
 ('10000000-0000-4000-8000-000000000854','delete-other@example.invalid');
INSERT INTO public.organizations(id,name,slug) VALUES
 ('20000000-0000-4000-8000-000000000851','People deletion native','people-deletion-native'),
 ('20000000-0000-4000-8000-000000000852','People deletion other','people-deletion-other');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000851','administrator'),
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000852','technician'),
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000853','end_user'),
 ('20000000-0000-4000-8000-000000000852','10000000-0000-4000-8000-000000000854','administrator');
INSERT INTO public.profiles(organization_id,user_id,display_name,email) VALUES
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000851','Deletion admin','delete-admin@example.invalid'),
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000852','Deletion technician','delete-tech@example.invalid'),
 ('20000000-0000-4000-8000-000000000851','10000000-0000-4000-8000-000000000853','Deletion employee','delete-employee@example.invalid');
SELECT extensions.ok(NOT has_function_privilege('anon','public.delete_workspace_people(uuid,uuid[],boolean)','execute'),'anonymous callers cannot invoke deletion');
SELECT extensions.ok(NOT has_column_privilege('authenticated','public.organization_memberships','deleted_at','update'),'browser roles cannot forge or clear deletion timestamps');
SET LOCAL ROLE authenticated;
SELECT pg_temp.set_test_session('{"sub":"10000000-0000-4000-8000-000000000852","role":"authenticated","aal":"aal1"}',true);
SELECT extensions.throws_ok($$SELECT public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000853','10000000-0000-4000-8000-000000000851']::uuid[],true)$$,'42501',NULL,'a mixed employee and administrator selection is rejected atomically');
SELECT extensions.is((SELECT status::text FROM public.organization_memberships WHERE user_id='10000000-0000-4000-8000-000000000853'),'active','rejected batch preserves the employee access');
SELECT extensions.throws_ok($$SELECT public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000853','10000000-0000-4000-8000-000000000854']::uuid[],true)$$,'P0002',NULL,'cross-workspace IDs reject the entire batch');
SELECT extensions.throws_ok($$SELECT public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000852']::uuid[],true)$$,'42501',NULL,'self deletion is rejected');
SELECT extensions.throws_ok($$SELECT public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000853']::uuid[],false)$$,'22023',NULL,'explicit acknowledgement is required');
SELECT extensions.is(public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000853']::uuid[],true),1,'technicians can delete employees');
SELECT extensions.is(public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000853']::uuid[],true),0,'retrying a completed deletion is harmless');
SELECT extensions.is((SELECT count(*)::int FROM public.search_members('20000000-0000-4000-8000-000000000851','Deletion employee')),0,'deleted people disappear from directory search');
SELECT extensions.is((SELECT count(*)::int FROM public.profiles WHERE user_id='10000000-0000-4000-8000-000000000853'),1,'historical profiles remain');
SELECT pg_temp.set_test_session('{"sub":"10000000-0000-4000-8000-000000000853","role":"authenticated","aal":"aal1"}',true);
SELECT extensions.ok(NOT private.is_active_organization_member('20000000-0000-4000-8000-000000000851'),'existing tokens no longer grant workspace access');
SELECT extensions.throws_ok($$SELECT public.delete_workspace_people('20000000-0000-4000-8000-000000000851',ARRAY['10000000-0000-4000-8000-000000000852']::uuid[],true)$$,'42501',NULL,'deleted accounts cannot delete anyone');
RESET ROLE;
SELECT extensions.is((SELECT count(*)::int FROM public.audit_events WHERE entity_type='organization_memberships' AND action='deleted' AND entity_id='10000000-0000-4000-8000-000000000853'),1,'a deletion audit record is committed exactly once');
SELECT extensions.is((SELECT count(*)::int FROM auth.users WHERE id='10000000-0000-4000-8000-000000000853'),1,'login identities are retained');
SELECT * FROM extensions.finish();
ROLLBACK;
