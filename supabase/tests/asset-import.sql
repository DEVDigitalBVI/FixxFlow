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

-- Batch insert, RLS and audit regression. All fixtures are rolled back.
begin;
create temporary table import_fixture as select gen_random_uuid() org,gen_random_uuid() other_org,gen_random_uuid() staff,gen_random_uuid() employee;
grant select on import_fixture to authenticated;
insert into auth.users(id,email) select staff,'import-staff-'||staff||'@example.test' from import_fixture union all select employee,'import-employee-'||employee||'@example.test' from import_fixture;
insert into public.organizations(id,name,slug) select org,'Import regression','import-'||org from import_fixture union all select other_org,'Other import regression','import-'||other_org from import_fixture;
insert into public.organization_memberships(organization_id,user_id,role) select org,staff,'technician'::public.app_role from import_fixture union all select org,employee,'end_user' from import_fixture;
select pg_temp.set_test_session(jsonb_build_object('sub',staff,'aal','aal2','session_id',gen_random_uuid())::text,true) from import_fixture;
set local role authenticated;
insert into public.assets(organization_id,tag,name,kind) select org,'BATCH-1','Batch laptop one','computer' from import_fixture union all select org,'BATCH-2','Batch laptop two','computer' from import_fixture;
do $$begin
 if (select count(*) from public.assets where organization_id=(select org from import_fixture))<>2 then raise exception 'Successful batch did not insert two rows';end if;
 begin
  insert into public.assets(organization_id,tag,name,kind) select org,'BATCH-3','Should roll back','computer' from import_fixture union all select org,' batch-1 ','Duplicate after normalization','computer' from import_fixture;
  raise exception 'Duplicate accepted';
 exception when unique_violation then null;end;
 if exists(select 1 from public.assets where tag='BATCH-3')then raise exception 'Failed batch partially committed';end if;
 begin
  insert into public.assets(organization_id,tag,name,kind) select org,'BATCH-4','Should roll back','computer' from import_fixture union all select other_org,'FOREIGN','Foreign asset','computer' from import_fixture;
  raise exception 'Foreign organization accepted';
 exception when insufficient_privilege then null;end;
 if exists(select 1 from public.assets where tag='BATCH-4')then raise exception 'RLS failure partially committed';end if;
end$$;
reset role;
do $$begin
 if (select count(*) from public.audit_events where organization_id=(select org from import_fixture) and entity_type='assets' and action='created')<>2 then raise exception 'Batch audit incorrect';end if;
end$$;
select pg_temp.set_test_session(jsonb_build_object('sub',employee,'aal','aal2','session_id',gen_random_uuid())::text,true) from import_fixture;
set local role authenticated;
do $$begin
 begin
  insert into public.assets(organization_id,tag,name,kind) select org,'EMP-1','Not allowed','computer' from import_fixture union all select org,'EMP-2','Not allowed','computer' from import_fixture;
  raise exception 'Employee batch accepted';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Asset batch regression passed; fixtures rolled back.' as result;
rollback;
