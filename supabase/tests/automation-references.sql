begin;
create function pg_temp.check_reference(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Automation reference assertion failed: %',message; end if; end $$;
insert into auth.users(id,email) select ('10000000-0000-0000-0000-00000000090'||n)::uuid,'reference-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000901','Reference A','reference-a'),
 ('20000000-0000-0000-0000-000000000902','Reference B','reference-b');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000901','10000000-0000-0000-0000-000000000901','administrator'),
 ('20000000-0000-0000-0000-000000000902','10000000-0000-0000-0000-000000000902','administrator'),
 ('20000000-0000-0000-0000-000000000901','10000000-0000-0000-0000-000000000903','technician'),
 ('20000000-0000-0000-0000-000000000901','10000000-0000-0000-0000-000000000904','end_user');
insert into public.teams(id,organization_id,name) select ('30000000-0000-0000-0000-00000000090'||n)::uuid,('20000000-0000-0000-0000-00000000090'||n)::uuid,'Reference team' from generate_series(1,2) n;
insert into public.ticket_categories(id,organization_id,name) select ('40000000-0000-0000-0000-00000000090'||n)::uuid,('20000000-0000-0000-0000-00000000090'||n)::uuid,'Reference category' from generate_series(1,2) n;
insert into public.ticket_subcategories(id,organization_id,category_id,name) select ('50000000-0000-0000-0000-00000000090'||n)::uuid,('20000000-0000-0000-0000-00000000090'||n)::uuid,('40000000-0000-0000-0000-00000000090'||n)::uuid,'Reference subcategory' from generate_series(1,2) n;
insert into public.departments(id,organization_id,name) select ('60000000-0000-0000-0000-00000000090'||n)::uuid,('20000000-0000-0000-0000-00000000090'||n)::uuid,'Reference department' from generate_series(1,2) n;
insert into public.locations(id,organization_id,name) select ('70000000-0000-0000-0000-00000000090'||n)::uuid,('20000000-0000-0000-0000-00000000090'||n)::uuid,'Reference location' from generate_series(1,2) n;
select set_config('test.reference_definition','{"schemaVersion":1,"name":"Reference rule","description":null,"trigger":{"type":"ticket.created","configuration":{}},"conditions":{"kind":"group","id":"root","operator":"and","children":[]},"actions":[{"id":"a","type":"set_priority","position":0,"configuration":{"priority":"high"}}]}',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000901","role":"authenticated","aal":"aal1"}',true);
do $$ declare org uuid:='20000000-0000-0000-0000-000000000901'; base jsonb:=current_setting('test.reference_definition')::jsonb; def jsonb; reference record; op text; target text; suffix text; version_count bigint; begin
 for reference in select * from (values
  ('assigned_technician_id','10000000'),('requester_id','10000000'),('team_id','30000000'),('category_id','40000000'),('subcategory_id','50000000'),('requester_department_id','60000000'),('location_id','70000000')
 ) as refs(field,prefix) loop
  foreach op in array array['equals','not_equals','in','not_in'] loop
   foreach suffix in array array['901','902','999'] loop
    target:=reference.prefix||'-0000-0000-0000-000000000'||suffix;
    def:=jsonb_set(base,'{conditions,children}',jsonb_build_array(jsonb_build_object('kind','condition','id','c','field',reference.field,'operator',op,'value',case when op in ('in','not_in') then jsonb_build_array(target) else to_jsonb(target) end)));
    if suffix='901' then perform public.create_automation_rule(org,def);
    else
     begin perform public.create_automation_rule(org,def); raise exception 'Cross-tenant or missing condition reference accepted: % %',reference.field,op; exception when invalid_parameter_value then null; end;
    end if;
   end loop;
  end loop;
 end loop;
 for reference in select * from (values ('assign_technician','technicianId','10000000'),('assign_team','teamId','30000000'),('set_category','categoryId','40000000')) as refs(action,property,prefix) loop
  foreach suffix in array array['901','902','999'] loop
   target:=reference.prefix||'-0000-0000-0000-000000000'||suffix;
   def:=jsonb_set(base,'{actions}',jsonb_build_array(jsonb_build_object('id','a','position',0,'type',reference.action,'configuration',jsonb_build_object(reference.property,target))));
   if suffix='901' then perform public.create_automation_rule(org,def);
   else begin perform public.create_automation_rule(org,def); raise exception 'Cross-tenant or missing action reference accepted'; exception when invalid_parameter_value then null; end;
   end if;
  end loop;
 end loop;
 select count(*) into version_count from public.automation_rule_versions;
 perform pg_temp.check_reference(version_count=31,'only 28 valid conditions and 3 valid actions persisted');
 def:=jsonb_set(base,'{actions}',jsonb_build_array(jsonb_build_object('id','a','position',0,'type','assign_technician','configuration',jsonb_build_object('technicianId','10000000-0000-0000-0000-000000000904'))));
 begin perform public.create_automation_rule(org,def); raise exception 'Employee accepted as technician'; exception when invalid_parameter_value then null; end;
 def:=jsonb_set(def,'{actions,0,configuration,technicianId}','"10000000-0000-0000-0000-000000000903"');
 perform set_config('test.reference_rule',(public.create_automation_rule(org,def)).id::text,true);
end $$;
reset role;
update public.organization_memberships set status='inactive',deactivated_at=now() where user_id='10000000-0000-0000-0000-000000000903';
update public.teams set is_active=false where id='30000000-0000-0000-0000-000000000901';
update public.ticket_categories set is_active=false where id='40000000-0000-0000-0000-000000000901';
set local role authenticated;
do $$ declare org uuid:='20000000-0000-0000-0000-000000000901'; def jsonb; reference record; begin
 begin perform public.set_automation_rule_enabled(org,current_setting('test.reference_rule')::uuid,1,true); raise exception 'Enable failed to revalidate inactive target'; exception when invalid_parameter_value then null; end;
 begin perform public.duplicate_automation_rule(org,current_setting('test.reference_rule')::uuid,1,'Invalid copy'); raise exception 'Duplicate failed to revalidate inactive target'; exception when invalid_parameter_value then null; end;
 for reference in select * from (values ('assign_technician','technicianId','10000000-0000-0000-0000-000000000903','assigned_technician_id'),('assign_team','teamId','30000000-0000-0000-0000-000000000901','team_id'),('set_category','categoryId','40000000-0000-0000-0000-000000000901','category_id')) as refs(action,property,target,field) loop
  def:=jsonb_set(current_setting('test.reference_definition')::jsonb,'{actions}',jsonb_build_array(jsonb_build_object('id','a','position',0,'type',reference.action,'configuration',jsonb_build_object(reference.property,reference.target))));
  begin perform public.create_automation_rule(org,def); raise exception 'Inactive action target accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.update_automation_rule(org,current_setting('test.reference_rule')::uuid,1,def); raise exception 'Update accepted inactive target'; exception when invalid_parameter_value then null; end;
  def:=jsonb_set(current_setting('test.reference_definition')::jsonb,'{conditions,children}',jsonb_build_array(jsonb_build_object('id','c','kind','condition','field',reference.field,'operator','equals','value',reference.target)));
  perform public.create_automation_rule(org,def); -- historical values remain valid conditions
 end loop;
 perform pg_temp.check_reference((select version=1 and not enabled from public.automation_rules where id=current_setting('test.reference_rule')::uuid),'failed operations leave rule unchanged');
 perform public.archive_automation_rule(org,current_setting('test.reference_rule')::uuid,1); -- invalid references must not prevent retirement
end $$;
reset role;
rollback;
