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

begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000961','location-admin@example.invalid'),
 ('10000000-0000-0000-0000-000000000962','location-employee@example.invalid'),
 ('10000000-0000-0000-0000-000000000963','location-other@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000961','Location hierarchy A','location-hierarchy-a'),
 ('20000000-0000-0000-0000-000000000962','Location hierarchy B','location-hierarchy-b');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000961','10000000-0000-0000-0000-000000000961','administrator'),
 ('20000000-0000-0000-0000-000000000961','10000000-0000-0000-0000-000000000962','end_user'),
 ('20000000-0000-0000-0000-000000000962','10000000-0000-0000-0000-000000000963','administrator');
insert into public.locations(id,organization_id,name) values
 ('30000000-0000-0000-0000-000000000961','20000000-0000-0000-0000-000000000961','Head office'),
 ('30000000-0000-0000-0000-000000000962','20000000-0000-0000-0000-000000000961','Branch'),
 ('30000000-0000-0000-0000-000000000963','20000000-0000-0000-0000-000000000962','Other workspace');
set local role authenticated;
select pg_temp.set_test_session('{"sub":"10000000-0000-0000-0000-000000000961","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select path from public.location_paths where id='30000000-0000-0000-0000-000000000961'),'Head office','existing top-level names stay unchanged');
insert into public.locations(id,organization_id,parent_id,name) values
 ('40000000-0000-0000-0000-000000000961','20000000-0000-0000-0000-000000000961','30000000-0000-0000-0000-000000000961','Room 101'),
 ('40000000-0000-0000-0000-000000000962','20000000-0000-0000-0000-000000000961','30000000-0000-0000-0000-000000000962','Room 101');
select extensions.is((select path from public.location_paths where id='40000000-0000-0000-0000-000000000961'),'Head office / Room 101','sublocations have complete paths');
select extensions.is((select count(*)::int from public.locations where name='Room 101'),2,'names can repeat under different parents');
select extensions.throws_ok($$insert into public.locations(organization_id,parent_id,name) values('20000000-0000-0000-0000-000000000961','30000000-0000-0000-0000-000000000961','Room 101')$$,'23505',null,'duplicate sibling names are rejected');
select extensions.throws_ok($$insert into public.locations(organization_id,name) values('20000000-0000-0000-0000-000000000961','Head office')$$,'23505',null,'duplicate root names are rejected');
select extensions.throws_ok($$update public.locations set parent_id=id where id='40000000-0000-0000-0000-000000000961'$$,'23514',null,'self-parenting is rejected');
select extensions.throws_ok($$update public.locations set parent_id='40000000-0000-0000-0000-000000000961' where id='30000000-0000-0000-0000-000000000961'$$,'23514',null,'moving a parent below its descendant is rejected');
select extensions.throws_ok($$update public.locations set parent_id='30000000-0000-0000-0000-000000000963' where id='40000000-0000-0000-0000-000000000961'$$,'23503',null,'cross-workspace parents are rejected');
select extensions.is((select count(*)::int from public.location_paths where organization_id='20000000-0000-0000-0000-000000000962'),0,'computed view preserves tenant isolation');
select extensions.throws_ok($$delete from public.locations where id='30000000-0000-0000-0000-000000000961'$$,'23503',null,'parents with children cannot be deleted');
select extensions.throws_ok($$update public.locations set is_active=false where id='30000000-0000-0000-0000-000000000961'$$,'23514',null,'active children must be deactivated first');
update public.locations set is_active=false where id='40000000-0000-0000-0000-000000000961';
update public.locations set is_active=false where id='30000000-0000-0000-0000-000000000961';
select extensions.throws_ok($$update public.locations set is_active=true where id='40000000-0000-0000-0000-000000000961'$$,'23514',null,'child cannot activate below an inactive ancestor');
update public.locations set is_active=true where id='30000000-0000-0000-0000-000000000961';
update public.locations set is_active=true where id='40000000-0000-0000-0000-000000000961';
select extensions.is((select label from public.lookup_choices('20000000-0000-0000-0000-000000000961','locations',selected=>'40000000-0000-0000-0000-000000000961')),'Head office / Room 101','shared ticket and asset lookup displays the path');
select extensions.is((select count(*)::int from public.lookup_choices('20000000-0000-0000-0000-000000000961','location_parents',parent=>'30000000-0000-0000-0000-000000000961')),2,'parent picker excludes self and descendants');
select extensions.is((select count(*)::int from public.lookup_choices('20000000-0000-0000-0000-000000000961','locations','Head office Room 101')),1,'lookup searches all words in the full path');
update public.locations set name='Main office' where id='30000000-0000-0000-0000-000000000961';
select extensions.is((select path from public.location_paths where id='40000000-0000-0000-0000-000000000961'),'Main office / Room 101','ancestor rename updates descendant paths immediately');
insert into public.tickets(organization_id,requester_id,title,description,location_id) values
 ('20000000-0000-0000-0000-000000000961','10000000-0000-0000-0000-000000000962','Hierarchy test ticket','Location reporting fixture','40000000-0000-0000-0000-000000000961');
select extensions.is((select (public.custom_report('20000000-0000-0000-0000-000000000961',jsonb_build_object('reportType','volume','startDate',(current_date-1)::text,'endDate',(current_date+1)::text,'interval','day','groupBy','location','metrics',jsonb_build_array('created'),'filters',jsonb_build_object('statuses','[]'::jsonb,'priorities','[]'::jsonb,'categoryIds','[]'::jsonb,'subcategoryIds','[]'::jsonb,'teamIds','[]'::jsonb,'technicianIds','[]'::jsonb,'departmentIds','[]'::jsonb,'locationIds',jsonb_build_array('30000000-0000-0000-0000-000000000961'))))->'summary'->0->>'value')::int),1,'parent report filter includes tickets at descendant locations');
update public.locations set parent_id=null where id='40000000-0000-0000-0000-000000000961';
select extensions.is((select path from public.location_paths where id='40000000-0000-0000-0000-000000000961'),'Room 101','moving a child to top-level updates its path');
select extensions.is((select count(*)::int from public.tickets where title='Hierarchy test ticket' and location_id='40000000-0000-0000-0000-000000000961'),1,'moves retain ticket links to the same location ID');
do $$declare parent uuid:='30000000-0000-0000-0000-000000000961'; child uuid; begin
 for level in 2..8 loop insert into public.locations(organization_id,parent_id,name) values('20000000-0000-0000-0000-000000000961',parent,'Level '||level) returning id into child; parent:=child; end loop;
end $$;
select extensions.is((select max(depth) from public.location_paths),8,'eight levels are supported');
select extensions.throws_ok($$insert into public.locations(organization_id,parent_id,name) select organization_id,id,'Level 9' from public.location_paths where depth=8$$,'23514',null,'depth limit is enforced');
select extensions.throws_ok($$update public.locations set parent_id=(select id from public.location_paths where depth=8) where id='30000000-0000-0000-0000-000000000962'$$,'23514',null,'moves cannot push existing descendants beyond the depth limit');
select extensions.ok(not has_table_privilege('authenticated','public.location_paths','insert'),'computed paths are read-only');
select pg_temp.set_test_session('{"sub":"10000000-0000-0000-0000-000000000962","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::int from public.lookup_choices('20000000-0000-0000-0000-000000000961','location_parents')),0,'employees cannot browse the admin parent picker');
select extensions.throws_ok($$insert into public.locations(organization_id,name) values('20000000-0000-0000-0000-000000000961','Unauthorized')$$,'42501',null,'employees cannot create locations');
select extensions.is((select label from public.lookup_choices('20000000-0000-0000-0000-000000000961','locations',selected=>'40000000-0000-0000-0000-000000000962')),'Branch / Room 101','employees retain normal path-labelled location choices');
reset role;
insert into public.organizations(id,name,slug) values('20000000-0000-0000-0000-000000000964','Disposable hierarchy','disposable-hierarchy');
insert into public.locations(id,organization_id,name) values('30000000-0000-0000-0000-000000000964','20000000-0000-0000-0000-000000000964','Root');
insert into public.locations(organization_id,parent_id,name) values('20000000-0000-0000-0000-000000000964','30000000-0000-0000-0000-000000000964','Child');
select extensions.lives_ok($$delete from public.organizations where id='20000000-0000-0000-0000-000000000964'$$,'workspace deletion still cascades through its hierarchy');
select * from extensions.finish();
rollback;
