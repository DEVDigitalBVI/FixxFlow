-- All test records and generated audit entries roll back. No emails are sent.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true),
 set_config('app.test_org',organization_id::text,true),set_config('app.test_actor',user_id::text,true)
from public.organization_memberships where role='administrator' and status='active' limit 1;
do $$
declare org uuid:=current_setting('app.test_org')::uuid; actor uuid:=auth.uid(); ticket uuid; event jsonb; before_count bigint; member uuid:=gen_random_uuid();
begin
  if org is null then raise exception 'Active administrator required'; end if;
  insert into public.tickets(organization_id,requester_id,title,description) values(org,actor,'Audit test ticket','SECRET_BODY_FIXTURE') returning id into ticket;
  update public.tickets set priority='high',status='in_progress',assigned_technician_id=actor where id=ticket;
  select changes into event from public.audit_events where entity_id=ticket and action='updated' order by id desc limit 1;
  if jsonb_array_length(event)<>3 then raise exception 'Multi-field change was lost: %',event; end if;
  if not exists(select 1 from public.audit_events where entity_id=ticket and actor_id=actor and actor_name not like 'Member %') then raise exception 'Actor snapshot missing'; end if;
  select count(*) into before_count from public.audit_events where entity_id=ticket;
  update public.tickets set priority='high' where id=ticket;
  if (select count(*) from public.audit_events where entity_id=ticket)<>before_count then raise exception 'No-op generated audit noise'; end if;
  insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values(org,ticket,actor,'internal_note','SECRET_NOTE_FIXTURE');
  if exists(select 1 from public.audit_events where organization_id=org and changes::text like '%SECRET_%') then raise exception 'Sensitive content copied'; end if;
  insert into public.departments(organization_id,name) values(org,'Audit temporary department');
  update public.departments set is_active=false where organization_id=org and name='Audit temporary department';
  if not exists(select 1 from public.audit_events where organization_id=org and entity_label='Audit temporary department' and action='updated') then raise exception 'Administration audit missing'; end if;
  insert into auth.users(id,email) values(member,'audit-'||member::text||'@example.invalid');
  perform set_config('app.test_member',member::text,true);
end $$;
-- Exercise the same service-role registration used after an email invitation.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.register_invited_member(current_setting('app.test_org')::uuid,current_setting('app.test_member')::uuid,'end_user','Audit invited member','audit@example.invalid',current_setting('app.test_actor')::uuid);
reset role;
do $$ begin
 if not exists(select 1 from public.audit_events where entity_id=current_setting('app.test_member')::uuid and entity_type='organization_memberships' and actor_id=current_setting('app.test_actor')::uuid and entity_label='Audit invited member') then raise exception 'Invitation actor missing'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('app.test_member'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.audit_events) then raise exception 'Employee can read audit records'; end if;
 begin perform public.register_invited_member(current_setting('app.test_org')::uuid,current_setting('app.test_member')::uuid,'administrator','Forbidden','forbidden@example.invalid',current_setting('app.test_actor')::uuid); raise exception 'Client can invoke service-only registration'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('app.test_actor'),'role','authenticated')::text,true);
do $$ begin
 if not exists(select 1 from public.audit_events where organization_id=current_setting('app.test_org')::uuid) then raise exception 'Administrator cannot read audit records'; end if;
 begin update public.audit_events set actor_name='Forged'; raise exception 'Audit modification allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.audit_events; raise exception 'Audit deletion allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.audit_events(organization_id,actor_name,entity_type,entity_id,entity_label,action) values(current_setting('app.test_org')::uuid,'Forged','tickets',gen_random_uuid(),'Forged','created'); raise exception 'Audit fabrication allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
do $$ begin if exists(select 1 from public.audit_events) then raise exception 'Outsider can read audit records'; end if; end $$;
reset role;
rollback;
