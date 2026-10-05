begin;
create function pg_temp.assert_org(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Organization deletion: %',message; end if; end $$;
insert into auth.users(id,email) values
('10000000-0000-0000-0000-000000000181','org-admin@example.test'),
('10000000-0000-0000-0000-000000000182','org-tech@example.test');
insert into public.organizations(id,name,slug) values
('20000000-0000-0000-0000-000000000181','Deletion regression','deletion-regression'),
('20000000-0000-0000-0000-000000000182','Other deletion regression','other-deletion-regression');
insert into public.organization_memberships(organization_id,user_id,role) values
('20000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000181','administrator'),
('20000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000182','technician');
insert into public.departments(id,organization_id,name) values
('30000000-0000-0000-0000-000000000181','20000000-0000-0000-0000-000000000181','Unused'),
('30000000-0000-0000-0000-000000000182','20000000-0000-0000-0000-000000000181','Linked'),
('30000000-0000-0000-0000-000000000183','20000000-0000-0000-0000-000000000182','Other');
insert into public.locations(id,organization_id,name) values
('40000000-0000-0000-0000-000000000181','20000000-0000-0000-0000-000000000181','Unused'),
('40000000-0000-0000-0000-000000000182','20000000-0000-0000-0000-000000000181','Person location'),
('40000000-0000-0000-0000-000000000183','20000000-0000-0000-0000-000000000181','Ticket location'),
('40000000-0000-0000-0000-000000000184','20000000-0000-0000-0000-000000000181','Asset location'),
('40000000-0000-0000-0000-000000000185','20000000-0000-0000-0000-000000000182','Other');
insert into public.profiles(organization_id,user_id,display_name,email,department_id,location_id) values
('20000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000181','Admin','org-admin@example.test','30000000-0000-0000-0000-000000000182','40000000-0000-0000-0000-000000000182');
insert into public.tickets(organization_id,requester_id,title,description,location_id) values
('20000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000181','Historical request','Preserve this location','40000000-0000-0000-0000-000000000183');
insert into public.assets(organization_id,tag,name,kind,status,location_id) values
('20000000-0000-0000-0000-000000000181','REGRESSION','Retired printer','printer','retired','40000000-0000-0000-0000-000000000184');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000182","aal":"aal1"}',true);
with deleted as (delete from public.departments where id='30000000-0000-0000-0000-000000000181' returning id)
select pg_temp.assert_org((select count(*)=0 from deleted),'technician cannot delete department');
with deleted as (delete from public.locations where id='40000000-0000-0000-0000-000000000181' returning id)
select pg_temp.assert_org((select count(*)=0 from deleted),'technician cannot delete location');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000181","aal":"aal1"}',true);
with deleted as (delete from public.departments where id='30000000-0000-0000-0000-000000000183' returning id)
select pg_temp.assert_org((select count(*)=0 from deleted),'cannot delete another organization department');
with deleted as (delete from public.locations where id='40000000-0000-0000-0000-000000000185' returning id)
select pg_temp.assert_org((select count(*)=0 from deleted),'cannot delete another organization location');
with deleted as (delete from public.departments where id='30000000-0000-0000-0000-000000000181' returning id)
select pg_temp.assert_org((select count(*)=1 from deleted),'admin deletes unused department');
with deleted as (delete from public.locations where id='40000000-0000-0000-0000-000000000181' returning id)
select pg_temp.assert_org((select count(*)=1 from deleted),'admin deletes unused location');
do $$ declare location uuid; begin
 begin
  delete from public.departments where id='30000000-0000-0000-0000-000000000182';
  raise exception 'Linked department deletion was allowed';
 exception when foreign_key_violation then null; end;
 foreach location in array array['40000000-0000-0000-0000-000000000182'::uuid,'40000000-0000-0000-0000-000000000183'::uuid,'40000000-0000-0000-0000-000000000184'::uuid] loop
  begin
   delete from public.locations where id=location;
   raise exception 'Linked location deletion was allowed';
  exception when foreign_key_violation then null; end;
 end loop;
end $$;
update public.departments set is_active=false where id='30000000-0000-0000-0000-000000000182';
update public.locations set is_active=false where id='40000000-0000-0000-0000-000000000182';
select pg_temp.assert_org((select department_id='30000000-0000-0000-0000-000000000182' and location_id='40000000-0000-0000-0000-000000000182' from public.profiles where user_id='10000000-0000-0000-0000-000000000181'),'deactivation preserves profile links');
do $$ begin
 begin delete from public.departments where id='30000000-0000-0000-0000-000000000182'; raise exception 'Inactive linked department deleted'; exception when foreign_key_violation then null; end;
 begin delete from public.locations where id='40000000-0000-0000-0000-000000000182'; raise exception 'Inactive linked location deleted'; exception when foreign_key_violation then null; end;
end $$;
update public.departments set is_active=true where id='30000000-0000-0000-0000-000000000182';
update public.locations set is_active=true where id='40000000-0000-0000-0000-000000000182';
select pg_temp.assert_org((select is_active from public.departments where id='30000000-0000-0000-0000-000000000182'),'can reactivate');
reset role;
select pg_temp.assert_org((select count(*)=2 from public.audit_events where organization_id='20000000-0000-0000-0000-000000000181' and action='deleted' and entity_type in ('departments','locations')),'successful deletions audited');
rollback;
