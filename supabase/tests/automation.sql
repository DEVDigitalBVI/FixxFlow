-- Plain PostgreSQL acceptance tests. Run after all migrations as postgres.
-- Every fixture rolls back; no execution, ticket mutations or delivery occurs.
begin;
create function pg_temp.check_automation(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Automation assertion failed: %',message; end if; end $$;
create function pg_temp.expect_automation_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;
  end;
  raise exception 'Expected %, statement succeeded: %',expected,statement;
end $$;
insert into auth.users(id,email) select ('10000000-0000-0000-0000-00000000080'||n)::uuid,'automation-'||n||'@example.invalid' from generate_series(1,6) n;
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000801','Automation A','automation-a'),
 ('20000000-0000-0000-0000-000000000802','Automation B','automation-b');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000801','10000000-0000-0000-0000-000000000801','administrator'),
 ('20000000-0000-0000-0000-000000000802','10000000-0000-0000-0000-000000000802','administrator'),
 ('20000000-0000-0000-0000-000000000801','10000000-0000-0000-0000-000000000803','technician'),
 ('20000000-0000-0000-0000-000000000801','10000000-0000-0000-0000-000000000804','end_user'),
 ('20000000-0000-0000-0000-000000000801','10000000-0000-0000-0000-000000000806','administrator');
update public.organization_memberships set status='inactive',deactivated_at=now() where user_id='10000000-0000-0000-0000-000000000806';
insert into private.platform_owners(user_id) values('10000000-0000-0000-0000-000000000805');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values
 (gen_random_uuid(),'10000000-0000-0000-0000-000000000801','totp','verified',now(),now()),
 (gen_random_uuid(),'10000000-0000-0000-0000-000000000805','totp','verified',now(),now());
insert into auth.sessions(id,user_id) values('90000000-0000-0000-0000-000000000805','10000000-0000-0000-0000-000000000805');
insert into public.profiles(organization_id,user_id,display_name) values
 ('20000000-0000-0000-0000-000000000801','10000000-0000-0000-0000-000000000801','Automation admin A');
select set_config('test.definition','{"schemaVersion":1,"name":"Route network requests","description":"PRIVATE_DEFINITION","trigger":{"type":"ticket.created","configuration":{}},"conditions":{"kind":"group","id":"root","operator":"and","children":[]},"actions":[{"id":"a","type":"set_priority","position":0,"configuration":{"priority":"high"}}]}',true);
select set_config('test.org_a','20000000-0000-0000-0000-000000000801',true),set_config('test.org_b','20000000-0000-0000-0000-000000000802',true);

-- B creates its own rule with unenrolled aal1, matching existing MFA behavior.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000802","role":"authenticated","aal":"aal1"}',true);
select set_config('test.rule_b',(public.create_automation_rule(current_setting('test.org_b')::uuid,current_setting('test.definition')::jsonb)).id::text,true);
select pg_temp.check_automation((select count(*)=1 from public.automation_rules),'B reads its own rule');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000801","role":"authenticated","aal":"aal2"}',true);
select pg_temp.check_automation((select count(*)=0 from public.automation_rules),'A cannot read B rules');
select pg_temp.check_automation((select count(*)=0 from public.automation_rule_versions),'A cannot read B versions');
select set_config('test.rule_a',(public.create_automation_rule(current_setting('test.org_a')::uuid,current_setting('test.definition')::jsonb)).id::text,true);
select pg_temp.check_automation((select version=1 and not enabled and created_by=auth.uid() and updated_by=auth.uid() and archived_at is null from public.automation_rules),'creation is disabled version 1 with trusted actor');
select pg_temp.check_automation((select count(*)=1 from public.automation_rule_versions),'creation snapshots version 1');

-- SQL direct writes and function bypass cannot avoid authorization/validation.
select pg_temp.expect_automation_error('update public.automation_rules set enabled=true','42501');
select pg_temp.expect_automation_error('insert into public.automation_rules(organization_id,definition,created_by,updated_by) values(current_setting(''test.org_a'')::uuid,current_setting(''test.definition'')::jsonb,auth.uid(),auth.uid())','42501');
select pg_temp.expect_automation_error('delete from public.automation_rules','42501');
select pg_temp.expect_automation_error('update public.automation_rule_versions set definition=''{}''','42501');
select pg_temp.expect_automation_error('delete from public.automation_rule_versions','42501');
select pg_temp.expect_automation_error('insert into public.automation_rule_versions select * from public.automation_rule_versions','42501');
select pg_temp.expect_automation_error('select private.validate_automation_definition(''{}'')','42501');
select pg_temp.expect_automation_error('select private.manage_automation_rule(current_setting(''test.org_b'')::uuid,null,''create'',null,current_setting(''test.definition'')::jsonb,null)','42501');
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,''{}'')','22023');
select pg_temp.expect_automation_error('select public.update_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,''{}'')','22023');

-- All operations are checked in both tenant directions. Supplying the victim
-- organization fails authorization; hiding its rule under one's own org is absent.
do $$ declare source_org text; victim_org text; victim_rule text; actor text; i integer; statement text; begin
 for i in 1..2 loop
  source_org:=current_setting(case when i=1 then 'test.org_a' else 'test.org_b' end);
  victim_org:=current_setting(case when i=1 then 'test.org_b' else 'test.org_a' end);
  victim_rule:=current_setting(case when i=1 then 'test.rule_b' else 'test.rule_a' end);
  actor:=case when i=1 then '10000000-0000-0000-0000-000000000801' else '10000000-0000-0000-0000-000000000802' end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.check_automation(not exists(select 1 from public.automation_rules where organization_id=victim_org::uuid),'cross tenant rule reads denied');
  perform pg_temp.check_automation(not exists(select 1 from public.automation_rule_versions where organization_id=victim_org::uuid),'cross tenant version reads denied');
  perform pg_temp.check_automation(not exists(select 1 from public.audit_events where organization_id=victim_org::uuid),'cross tenant audit reads denied');
  perform pg_temp.expect_automation_error(format('select public.create_automation_rule(%L,current_setting(''test.definition'')::jsonb)',victim_org),'42501');
  foreach statement in array array[
   format('select public.update_automation_rule(%L,%L,1,current_setting(''test.definition'')::jsonb)',victim_org,victim_rule),
   format('select public.duplicate_automation_rule(%L,%L,1,''copy'')',victim_org,victim_rule),
   format('select public.set_automation_rule_enabled(%L,%L,1,true)',victim_org,victim_rule),
   format('select public.set_automation_rule_enabled(%L,%L,1,false)',victim_org,victim_rule),
   format('select public.archive_automation_rule(%L,%L,1)',victim_org,victim_rule)
  ] loop
   perform pg_temp.expect_automation_error(statement,'42501');
   perform pg_temp.expect_automation_error(replace(statement,victim_org,source_org),'P0002');
  end loop;
 end loop;
end $$;

-- Technician, employee, platform owner, inactive admin, enrolled aal1 admin.
do $$ declare actor text; claims jsonb; statement text; begin
 foreach actor in array array['10000000-0000-0000-0000-000000000803','10000000-0000-0000-0000-000000000804','10000000-0000-0000-0000-000000000805','10000000-0000-0000-0000-000000000806','10000000-0000-0000-0000-000000000801'] loop
  claims:=jsonb_build_object('sub',actor,'role','authenticated','session_id','90000000-0000-0000-0000-000000000805','aal',case when actor like '%801' then 'aal1' else 'aal2' end);
  perform set_config('request.jwt.claims',claims::text,true);
  if actor like '%805' then perform pg_temp.check_automation(public.platform_access()='ready','fully verified platform owner fixture'); end if;
  perform pg_temp.check_automation(not exists(select 1 from public.automation_rules),'unauthorized rules hidden');
  perform pg_temp.check_automation(not exists(select 1 from public.automation_rule_versions),'unauthorized versions hidden');
  perform pg_temp.check_automation(not exists(select 1 from public.audit_events where entity_type='automation_rules'),'unauthorized automation audit hidden');
  foreach statement in array array[
   'select public.create_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.definition'')::jsonb)',
   'select public.update_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,current_setting(''test.definition'')::jsonb)',
   'select public.duplicate_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,''copy'')',
   'select public.set_automation_rule_enabled(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,true)',
   'select public.set_automation_rule_enabled(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,false)',
   'select public.archive_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1)',
   'select private.manage_automation_rule(current_setting(''test.org_a'')::uuid,null,''create'',null,current_setting(''test.definition'')::jsonb,null)'
  ] loop perform pg_temp.expect_automation_error(statement,'42501'); end loop;
 end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.definition'')::jsonb)','42501');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000801","role":"authenticated","aal":"aal2"}',true);

-- Revisions and optimistic edits. A stale request may never succeed, even if
-- its payload is now a no-op. Lifecycle changes consume the same version token.
select public.update_automation_rule(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,1,jsonb_set(current_setting('test.definition')::jsonb,'{name}','"Edited rule"'));
select pg_temp.check_automation((select version=2 and name='Edited rule' from public.automation_rules),'update advances version');
select pg_temp.check_automation((select definition=current_setting('test.definition')::jsonb and not enabled from public.automation_rule_versions where version=1),'original revision unchanged');
select pg_temp.expect_automation_error('select public.update_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,current_setting(''test.definition'')::jsonb)','40001');
select pg_temp.expect_automation_error('select public.set_automation_rule_enabled(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,1,true)','40001');
select public.update_automation_rule(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,2,jsonb_set(current_setting('test.definition')::jsonb,'{name}','"Edited rule"'));
select pg_temp.check_automation((select count(*)=2 from public.automation_rule_versions),'no-op has no extra revision');
select public.set_automation_rule_enabled(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,2,true);
select pg_temp.check_automation((select enabled and enabled_at is not null and version=3 from public.automation_rules),'enable timestamps and revisions');
select public.set_automation_rule_enabled(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,3,true);
select pg_temp.check_automation((select version=3 from public.automation_rules),'repeated enable is a no-op');
select set_config('test.copy',(public.duplicate_automation_rule(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,3,'Independent copy')).id::text,true);
select pg_temp.check_automation((select version=1 and not enabled and enabled_at is null and id<>current_setting('test.rule_a')::uuid and name='Independent copy' from public.automation_rules where id=current_setting('test.copy')::uuid),'duplicate starts independent disabled version 1');
select public.set_automation_rule_enabled(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,3,false);
select pg_temp.check_automation((select not enabled and enabled_at is null and version=4 from public.automation_rules where id=current_setting('test.rule_a')::uuid),'disable clears active state');
select public.set_automation_rule_enabled(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,4,true);
select pg_temp.expect_automation_error('select public.archive_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,4)','40001');
select public.archive_automation_rule(current_setting('test.org_a')::uuid,current_setting('test.rule_a')::uuid,5);
select pg_temp.check_automation((select not enabled and enabled_at is null and archived_at is not null and version=6 from public.automation_rules where id=current_setting('test.rule_a')::uuid),'archive disables and advances version');
select pg_temp.expect_automation_error('select public.set_automation_rule_enabled(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,6,true)','55000');
select pg_temp.expect_automation_error('select public.set_automation_rule_enabled(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,6,false)','55000');
select pg_temp.expect_automation_error('select public.update_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,6,current_setting(''test.definition'')::jsonb)','55000');
select pg_temp.expect_automation_error('select public.duplicate_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,6,''copy'')','55000');
select pg_temp.expect_automation_error('select public.archive_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.rule_a'')::uuid,6)','55000');
select pg_temp.check_automation((select count(*)=6 from public.automation_rule_versions where rule_id=current_setting('test.rule_a')::uuid),'archived history retained');
select pg_temp.check_automation((select array_agg(action order by id)=array['created','updated','enabled','disabled','enabled','deleted'] from public.audit_events where entity_id=current_setting('test.rule_a')::uuid),'all administrative audit transitions exactly once');
select pg_temp.check_automation((select bool_and(actor_id=auth.uid() and actor_name='Automation admin A' and organization_id=current_setting('test.org_a')::uuid) from public.audit_events where entity_id=current_setting('test.rule_a')::uuid),'audit actor and tenant trusted');
select pg_temp.check_automation(not exists(select 1 from public.audit_events where changes::text like '%PRIVATE_DEFINITION%'),'no full definition in audit');

-- Database owner also cannot accidentally mutate historical rows or hard-delete.
reset role;
-- Failure after the active row and audit trigger must roll back both writes.
alter table public.automation_rule_versions add constraint test_atomic_version check(definition->>'name'<>'Atomic failure');
set local role authenticated;
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,jsonb_set(current_setting(''test.definition'')::jsonb,''{name}'',''"Atomic failure"''))','23514');
select pg_temp.check_automation(not exists(select 1 from public.automation_rules where name='Atomic failure'),'version insertion failure rolls back active rule');
select pg_temp.check_automation(not exists(select 1 from public.audit_events where entity_label='Atomic failure'),'version insertion failure rolls back audit');
reset role;
alter table public.audit_events add constraint test_atomic_audit check(entity_label<>'Audit failure');
set local role authenticated;
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,jsonb_set(current_setting(''test.definition'')::jsonb,''{name}'',''"Audit failure"''))','23514');
select pg_temp.check_automation(not exists(select 1 from public.automation_rules where name='Audit failure'),'audit failure rolls back active rule');
select pg_temp.check_automation(not exists(select 1 from public.automation_rule_versions where definition->>'name' in ('Audit failure','Atomic failure')),'failed writes leave no revision');
reset role;
select pg_temp.expect_automation_error('update public.automation_rule_versions set definition=''{}''','P0001');
select pg_temp.expect_automation_error('delete from public.automation_rule_versions','P0001');
select pg_temp.expect_automation_error('delete from public.automation_rules','P0001');
set local role service_role;
select pg_temp.expect_automation_error('select * from public.automation_rules','42501');
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.definition'')::jsonb)','42501');
set local role anon;
select pg_temp.expect_automation_error('select * from public.automation_rules','42501');
select pg_temp.expect_automation_error('select public.create_automation_rule(current_setting(''test.org_a'')::uuid,current_setting(''test.definition'')::jsonb)','42501');
reset role;
rollback;
