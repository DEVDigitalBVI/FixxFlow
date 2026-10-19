-- A shared staff-only coordination root lets maintenance and other procedures use
-- the existing response features without declaring an incident or changing ticket status.
create table public.ticket_workflows (
 ticket_id uuid primary key, organization_id uuid not null,
 kind text not null check(kind in ('incident','maintenance','procedure')),
 owner_id uuid not null, revision bigint not null default 1,
 created_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,owner_id) references public.organization_memberships(organization_id,user_id)
);
create index ticket_workflows_owner_idx on public.ticket_workflows(organization_id,owner_id);
alter table public.ticket_workflows enable row level security;
revoke all on public.ticket_workflows from public,anon,authenticated;
grant select on public.ticket_workflows to authenticated;
create policy "Staff read ticket workflows" on public.ticket_workflows for select to authenticated using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()));
-- Backfill only the new root. Existing tickets, steps and history are untouched.
insert into public.ticket_workflows(ticket_id,organization_id,kind,owner_id,created_at)
select ticket_id,organization_id,'incident',owner_id,created_at from public.ticket_incidents;
create function private.sync_incident_workflow() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Workflow access denied' using errcode='42501';end if;
 insert into public.ticket_workflows(ticket_id,organization_id,kind,owner_id,created_at) values(new.ticket_id,new.organization_id,'incident',new.owner_id,new.created_at)
 on conflict(ticket_id) do update set kind='incident',owner_id=excluded.owner_id,revision=ticket_workflows.revision+1
 where ticket_workflows.organization_id=excluded.organization_id and row(ticket_workflows.kind,ticket_workflows.owner_id) is distinct from row('incident'::text,excluded.owner_id);
 return new;
end $$;
revoke all on function private.sync_incident_workflow() from public,anon,authenticated;
create trigger ticket_incidents_workflow_sync after insert or update on public.ticket_incidents for each row execute function private.sync_incident_workflow();
-- Retain all existing tenant FKs and move only the coordination-root relationship.
do $$declare item record;begin
 for item in select c.conrelid::regclass relation,c.conname from pg_constraint c where c.contype='f' and c.confrelid='public.ticket_incidents'::regclass loop
  execute format('alter table %s drop constraint %I',item.relation,item.conname);
  execute format('alter table %s add constraint %I foreign key(ticket_id) references public.ticket_workflows(ticket_id) on delete cascade',item.relation,item.conname);
 end loop;
end $$;

-- Row locking requires UPDATE privilege. Keep the root read-only for clients
-- and expose only this tenant/assurance-checked private locking helper.
create function private.lock_ticket_workflow(org uuid,ticket uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then return false;end if;
 perform 1 from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 return found;
end $$;
revoke all on function private.lock_ticket_workflow(uuid,uuid) from public,anon;
grant execute on function private.lock_ticket_workflow(uuid,uuid) to authenticated;
-- Reuse the existing behavior and guards against the shared coordination root.
create or replace function private.validate_incident_step() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501'; end if;
 -- Serializes additions and validates the tenant against the actual incident.
 perform 1 where private.lock_ticket_workflow(new.organization_id,new.ticket_id);
 if not found then raise exception 'Workflow unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_memberships where organization_id=new.organization_id and user_id=new.assignee_id and status='active' and role in ('administrator','technician')) then raise exception 'Choose an active step assignee'; end if;
 if tg_op='INSERT' then
  if (select count(*) from public.incident_steps where ticket_id=new.ticket_id)>=100 then raise exception 'An incident supports up to 100 response steps'; end if;
  new.revision:=1; new.created_at:=now(); new.acknowledged_at:=null; new.completed_at:=null;
 else
  if row(new.id,new.organization_id,new.ticket_id,new.created_at) is distinct from row(old.id,old.organization_id,old.ticket_id,old.created_at) then raise exception 'Step identity cannot change'; end if;
  if new.revision<>old.revision+1 then raise exception 'Step changed; review latest details' using errcode='PT409'; end if;
  if old.completed_at is not null and new.completed_at is not null and new.completed_at is distinct from old.completed_at then raise exception 'Reopen a completed step before editing'; end if;
  if row(new.title,new.instructions,new.assignee_id,new.due_at) is distinct from row(old.title,old.instructions,old.assignee_id,old.due_at) then
   if old.completed_at is not null then raise exception 'Reopen a completed step before editing'; end if;
   if new.acknowledged_at is distinct from old.acknowledged_at or new.completed_at is distinct from old.completed_at then raise exception 'Edit step details separately'; end if;
   if new.assignee_id<>old.assignee_id then new.acknowledged_at:=null; end if;
  elsif new.completed_at is distinct from old.completed_at then
   if new.completed_at is null then new.acknowledged_at:=null;
   else
    if auth.uid()<>old.assignee_id or old.acknowledged_at is null then raise exception 'Only the assigned person can complete an acknowledged step' using errcode='42501'; end if;
    new.completed_at:=now(); new.acknowledged_at:=old.acknowledged_at;
   end if;
  elsif new.acknowledged_at is distinct from old.acknowledged_at then
   if auth.uid()<>old.assignee_id or old.acknowledged_at is not null or old.completed_at is not null or new.acknowledged_at is null then raise exception 'Only the assigned person can acknowledge a pending step' using errcode='42501'; end if;
   new.acknowledged_at:=now();
  else raise exception 'No step change'; end if;
 end if;
 new.title:=trim(new.title); new.updated_at:=now(); return new;
end $$;

create or replace function public.change_incident_step(org uuid,ticket uuid,step uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare saved public.incident_steps; result bigint;
begin
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501'; end if;
 perform 1 where private.lock_ticket_workflow(org,ticket);
 if not found then raise exception 'Workflow unavailable' using errcode='42501'; end if;
 select * into saved from public.incident_steps where id=step and organization_id=org and ticket_id=ticket for update;
 if operation='add' then
  if found then
   if saved.title=trim(payload->>'title') and saved.instructions=coalesce(payload->>'instructions','') and saved.assignee_id=(payload->>'assignee_id')::uuid and saved.due_at is not distinct from (payload->>'due_at')::timestamptz then return saved.revision; end if;
   raise exception 'Step already exists; review latest details' using errcode='PT409';
  end if;
  insert into public.incident_steps(id,organization_id,ticket_id,title,instructions,assignee_id,due_at)
  values(step,org,ticket,payload->>'title',coalesce(payload->>'instructions',''),(payload->>'assignee_id')::uuid,(payload->>'due_at')::timestamptz) returning revision into result;
  return result;
 end if;
 if saved.id is null then raise exception 'Step unavailable' using errcode='42501'; end if;
 if expected_revision is null or saved.revision<>expected_revision then raise exception 'Step changed; review latest details' using errcode='PT409'; end if;
 if operation='edit' then
  if row(saved.title,saved.instructions,saved.assignee_id,saved.due_at) is not distinct from row(trim(payload->>'title'),coalesce(payload->>'instructions',''),(payload->>'assignee_id')::uuid,(payload->>'due_at')::timestamptz) then return saved.revision; end if;
  update public.incident_steps set title=payload->>'title',instructions=coalesce(payload->>'instructions',''),assignee_id=(payload->>'assignee_id')::uuid,due_at=(payload->>'due_at')::timestamptz,revision=revision+1 where id=step returning revision into result;
 elsif operation='acknowledge' and saved.acknowledged_at is null then
  update public.incident_steps set acknowledged_at=now(),revision=revision+1 where id=step returning revision into result;
 elsif operation='complete' and saved.completed_at is null then
  update public.incident_steps set completed_at=now(),revision=revision+1 where id=step returning revision into result;
 elsif operation='reopen' and saved.completed_at is not null then
  update public.incident_steps set completed_at=null,revision=revision+1 where id=step returning revision into result;
 else raise exception 'Step action is unavailable'; end if;
 return result;
end $$;

create or replace function private.manage_incident_communication(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare incident public.ticket_workflows; plan public.incident_communication_plans; grp public.incident_stakeholder_groups;
 draft public.incident_update_drafts; gids uuid[]; recipients uuid[]; names text[]; person uuid; result bigint; deadline timestamptz;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Communication access denied' using errcode='42501'; end if;
 select * into incident from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Workflow unavailable' using errcode='42501'; end if;
 if operation='save_plan' then
  person:=(payload->>'owner_id')::uuid; deadline:=(payload->>'next_update_at')::timestamptz;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=person and status='active' and role in ('administrator','technician')) then raise exception 'Choose an active communication owner'; end if;
  select * into plan from public.incident_communication_plans where ticket_id=ticket;
  if expected_revision is null or coalesce(plan.revision,0)<>expected_revision then raise exception 'Communication plan changed' using errcode='PT409'; end if;
  insert into public.incident_communication_plans(ticket_id,organization_id,owner_id,next_update_at) values(ticket,org,person,deadline)
  on conflict(ticket_id) do update set owner_id=excluded.owner_id,next_update_at=excluded.next_update_at,
   reminded_at=case when row(incident_communication_plans.owner_id,incident_communication_plans.next_update_at) is distinct from row(excluded.owner_id,excluded.next_update_at) then null else incident_communication_plans.reminded_at end,
   revision=incident_communication_plans.revision+1,updated_at=now() returning revision into result;
  return result;
 elsif operation='save_group' then
  select * into grp from public.incident_stakeholder_groups where id=target and organization_id=org and ticket_id=ticket;
  if grp.id is null then
   if expected_revision is distinct from 0::bigint then raise exception 'Group changed' using errcode='PT409'; end if;
   if (select count(*) from public.incident_stakeholder_groups where ticket_id=ticket and not archived)>=20 then raise exception 'Up to 20 active groups per incident'; end if;
   insert into public.incident_stakeholder_groups(id,organization_id,ticket_id,name) values(target,org,ticket,trim(payload->>'name')) returning revision into result;
  else
   if grp.revision is distinct from expected_revision or grp.archived then raise exception 'Group changed' using errcode='PT409'; end if;
   update public.incident_stakeholder_groups set name=trim(payload->>'name'),revision=revision+1 where id=target returning revision into result;
  end if;
  return result;
 elsif operation in ('add_member','remove_member','archive_group') then
  select * into grp from public.incident_stakeholder_groups where id=target and organization_id=org and ticket_id=ticket;
  if grp.id is null or grp.archived then raise exception 'Group unavailable'; end if;
  if grp.revision is distinct from expected_revision then raise exception 'Group changed' using errcode='PT409'; end if;
  person:=(payload->>'user_id')::uuid;
  if operation='add_member' then
   if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=person and status='active') then raise exception 'Choose an active company member'; end if;
   if not exists(select 1 from public.incident_stakeholder_members where group_id=target and user_id=person) then
    if (select count(*) from public.incident_stakeholder_members where group_id=target)>=100 then raise exception 'Up to 100 members per group'; end if;
    insert into public.incident_stakeholder_members values(org,ticket,target,person);
   end if;
  elsif operation='remove_member' then delete from public.incident_stakeholder_members where group_id=target and user_id=person;
  else update public.incident_stakeholder_groups set archived=true where id=target;
  end if;
  update public.incident_stakeholder_groups set revision=revision+1 where id=target returning revision into result;return result;
 elsif operation='save_draft' then
  select * into draft from public.incident_update_drafts where id=target and organization_id=org and ticket_id=ticket;
  if draft.id is not null and draft.status<>'draft' then raise exception 'Published or discarded drafts cannot change'; end if;
  if coalesce(draft.revision,0) is distinct from expected_revision then raise exception 'Draft changed' using errcode='PT409'; end if;
  if draft.id is null and (select count(*) from public.incident_update_drafts where ticket_id=ticket and status='draft')>=20 then raise exception 'Up to 20 pending drafts per incident'; end if;
  gids:=array(select distinct value::uuid from jsonb_array_elements_text(payload->'group_ids'));
  if cardinality(gids) not between 1 and 10 or (select count(*) from public.incident_stakeholder_groups where organization_id=org and ticket_id=ticket and id=any(gids) and not archived)<>cardinality(gids) then raise exception 'Choose 1–10 active stakeholder groups'; end if;
  select array_agg(g.name order by g.name) into names from public.incident_stakeholder_groups g where id=any(gids);
  select array_agg(distinct m.user_id order by m.user_id) into recipients from public.incident_stakeholder_members m join public.organization_memberships u on u.organization_id=m.organization_id and u.user_id=m.user_id where m.organization_id=org and m.ticket_id=ticket and m.group_id=any(gids) and u.status='active';
  if coalesce(cardinality(recipients),0) not between 1 and 500 then raise exception 'Choose groups with 1–500 active recipients in total'; end if;
  insert into public.incident_update_drafts(id,organization_id,ticket_id,title,body,group_ids,group_names,recipient_ids,next_update_at,created_by,updated_by)
  values(target,org,ticket,trim(payload->>'title'),trim(payload->>'body'),gids,names,recipients,(payload->>'next_update_at')::timestamptz,auth.uid(),auth.uid())
  on conflict(id) do update set title=excluded.title,body=excluded.body,group_ids=excluded.group_ids,group_names=excluded.group_names,recipient_ids=excluded.recipient_ids,next_update_at=excluded.next_update_at,revision=incident_update_drafts.revision+1,updated_by=auth.uid(),updated_at=now() where incident_update_drafts.organization_id=org and incident_update_drafts.ticket_id=ticket and incident_update_drafts.status='draft' and incident_update_drafts.revision=expected_revision returning revision into result;
  if result is null then raise exception 'Draft unavailable' using errcode='42501'; end if;
  return result;
 elsif operation in ('publish','discard_draft') then
  select * into draft from public.incident_update_drafts where id=target and organization_id=org and ticket_id=ticket;
  if draft.id is null then raise exception 'Draft unavailable'; end if;
  if operation='publish' then
   if incident.owner_id<>auth.uid() and not exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active' and role='administrator') then raise exception 'Only the coordinator or an administrator can approve updates' using errcode='42501'; end if;
   -- Successful retries never enqueue a second publication or email.
   if draft.status='sent' then return draft.revision; end if;
  end if;
  if draft.status<>'draft' or draft.revision is distinct from expected_revision then raise exception 'Draft changed' using errcode='PT409'; end if;
  if operation='discard_draft' then update public.incident_update_drafts set status='discarded',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target returning revision into result;return result;end if;
  -- Never silently substitute a different audience after approval preview.
  perform 1 from public.organization_memberships where organization_id=org and user_id=any(draft.recipient_ids) order by user_id for share;
  if (select count(*) from public.organization_memberships where organization_id=org and user_id=any(draft.recipient_ids) and status='active')<>cardinality(draft.recipient_ids) then raise exception 'Recipients changed; save the draft again to refresh its audience'; end if;
  insert into public.incident_bulletins(id,organization_id,ticket_id,title,body,next_update_at,prepared_by,approved_by,recipient_count)
  values(target,org,ticket,draft.title,draft.body,draft.next_update_at,draft.created_by,auth.uid(),cardinality(draft.recipient_ids));
  insert into public.incident_bulletin_recipients select org,target,unnest(draft.recipient_ids);
  foreach person in array draft.recipient_ids loop
   perform private.enqueue_notification(org,person,null,ticket,null,'incident_update',draft.title,false,'incident-update:'||target||':'||person);
   update public.notifications set incident_bulletin_id=target where organization_id=org and recipient_id=person and event_key='incident-update:'||target||':'||person;
  end loop;
  insert into public.incident_communication_plans(ticket_id,organization_id,owner_id,next_update_at) values(ticket,org,incident.owner_id,draft.next_update_at)
  on conflict(ticket_id) do update set next_update_at=excluded.next_update_at,reminded_at=null,revision=incident_communication_plans.revision+1,updated_at=now();
  update public.incident_update_drafts set status='sent',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target returning revision into result;
  return result;
 end if;
 raise exception 'Communication action unavailable';
end $$;

create or replace function private.manage_incident_control(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare incident public.ticket_workflows; incident_details public.ticket_incidents; policy public.incident_escalation_policies; approval public.incident_approvals; previous public.incident_approvals;
 step public.incident_steps; actor uuid:=auth.uid(); primary_id uuid; backup_id uuid; result bigint; is_manager boolean; ticket_revision bigint;
begin
 if actor is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident control access denied' using errcode='42501';end if;
 -- Ownership changes follow the existing ticket -> incident lock order.
 if operation='take_over' then select revision into ticket_revision from public.tickets where organization_id=org and id=ticket for update;end if;
 select * into incident from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Workflow unavailable' using errcode='42501';end if;
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident control access denied' using errcode='42501';end if;
 is_manager:=incident.owner_id=actor or exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=actor and m.status='active' and m.role='administrator');
 select * into policy from public.incident_escalation_policies where ticket_id=ticket;
 if operation='save_policy' then
  if not is_manager then raise exception 'Only the coordinator or an administrator can change escalation' using errcode='42501';end if;
  if coalesce(policy.revision,0) is distinct from expected_revision then raise exception 'Escalation plan changed' using errcode='PT409';end if;
  backup_id:=nullif(payload->>'backup_owner_id','')::uuid;
  if backup_id is not null and (backup_id=incident.owner_id or not exists(select 1 from public.organization_memberships where organization_id=org and user_id=backup_id and status='active' and role in ('administrator','technician'))) then raise exception 'Choose a different active backup owner';end if;
  if coalesce((payload->>'enabled')::boolean,false) and backup_id is null then raise exception 'Choose a backup owner before enabling escalation';end if;
  insert into public.incident_escalation_policies(ticket_id,organization_id,backup_owner_id,enabled,acknowledgement_minutes,overdue_minutes)
  values(ticket,org,backup_id,(payload->>'enabled')::boolean,(payload->>'acknowledgement_minutes')::integer,(payload->>'overdue_minutes')::integer)
  on conflict(ticket_id) do update set backup_owner_id=excluded.backup_owner_id,enabled=excluded.enabled,acknowledgement_minutes=excluded.acknowledgement_minutes,overdue_minutes=excluded.overdue_minutes,revision=incident_escalation_policies.revision+1,updated_at=now() returning * into policy;
  insert into public.incident_control_history(organization_id,ticket_id,actor_id,action,snapshot) values(org,ticket,actor,'policy_saved',jsonb_build_object('policy',to_jsonb(policy)));
  return policy.revision;
 elsif operation='take_over'  then
  if policy.ticket_id is null or policy.revision is distinct from expected_revision or policy.backup_owner_id is distinct from actor then raise exception 'Only the current backup owner can take over; review the latest plan' using errcode='PT409';end if;
  if incident.kind='incident' then
   select * into incident_details from public.ticket_incidents where organization_id=org and ticket_id=ticket;
   perform public.save_ticket_incident(org,ticket,ticket_revision,jsonb_build_object('severity',incident_details.severity,'business_impact',incident_details.business_impact,'owner_id',actor,'affected_services',incident_details.affected_services,'affected_locations',incident_details.affected_locations));
  else update public.ticket_workflows set owner_id=actor,revision=revision+1 where organization_id=org and ticket_id=ticket;end if;
  backup_id:=case when exists(select 1 from public.organization_memberships where organization_id=org and user_id=incident.owner_id and status='active' and role in ('administrator','technician')) then incident.owner_id else null end;
  update public.incident_escalation_policies set backup_owner_id=backup_id,enabled=enabled and backup_id is not null,revision=revision+1,updated_at=now() where ticket_id=ticket returning revision into result;
  perform private.enqueue_notification(org,incident.owner_id,actor,ticket,null,'incident_escalation','Backup has taken over coordination',true,'incident-takeover:'||ticket||':'||result);
  insert into public.incident_control_history(organization_id,ticket_id,actor_id,action,snapshot) values(org,ticket,actor,'incident_taken_over',jsonb_build_object('previous_owner_id',incident.owner_id,'owner_id',actor,'backup_owner_id',backup_id));
  return result;
 elsif operation='request_approval' then
  if not is_manager then raise exception 'Only the coordinator or an administrator can request approvals' using errcode='42501';end if;
  select * into approval from public.incident_approvals where id=target;
  if found then
   if approval.organization_id=org and approval.ticket_id=ticket and approval.requested_by=actor and approval.title=trim(payload->>'title') and approval.description=trim(payload->>'description') and approval.approver_id=(payload->>'approver_id')::uuid and approval.backup_approver_id is not distinct from nullif(payload->>'backup_approver_id','')::uuid and approval.step_id is not distinct from nullif(payload->>'step_id','')::uuid and approval.due_at=(payload->>'due_at')::timestamptz then return approval.revision;end if;
   raise exception 'Approval request already exists' using errcode='PT409';
  end if;
  if (select count(*) from public.incident_approvals where ticket_id=ticket and status='pending' and superseded_by is null and (nullif(payload->>'step_id','') is null or step_id is distinct from (payload->>'step_id')::uuid))>=20 then raise exception 'Up to 20 pending approval requests per incident';end if;
  primary_id:=(payload->>'approver_id')::uuid;backup_id:=nullif(payload->>'backup_approver_id','')::uuid;
  if primary_id=actor or primary_id is null or not exists(select 1 from public.organization_memberships where organization_id=org and user_id=primary_id and status='active' and role in ('administrator','technician')) then raise exception 'Choose another active staff member as approver';end if;
  if backup_id is not null and (backup_id=actor or backup_id=primary_id or not exists(select 1 from public.organization_memberships where organization_id=org and user_id=backup_id and status='active' and role in ('administrator','technician'))) then raise exception 'Choose a different active backup approver';end if;
  if nullif(payload->>'step_id','') is not null then
   select * into step from public.incident_steps where organization_id=org and ticket_id=ticket and id=(payload->>'step_id')::uuid for update;
   if not found or step.completed_at is not null then raise exception 'Choose an unfinished step in this incident';end if;
   select * into previous from public.incident_approvals where organization_id=org and ticket_id=ticket and step_id=step.id and superseded_by is null and status<>'cancelled';
   if found then
    update public.incident_approvals set superseded_by=target,revision=revision+1 where id=previous.id returning * into previous;
    insert into public.incident_approval_history(organization_id,ticket_id,approval_id,actor_id,action,snapshot) values(org,ticket,previous.id,actor,'superseded',to_jsonb(previous));
   end if;
  end if;
  insert into public.incident_approvals(id,organization_id,ticket_id,step_id,step_work_version,step_snapshot,title,description,approver_id,backup_approver_id,due_at,requested_by)
  values(target,org,ticket,step.id,step.work_version,case when step.id is null then null else to_jsonb(step) end,trim(payload->>'title'),trim(payload->>'description'),primary_id,backup_id,(payload->>'due_at')::timestamptz,actor) returning * into approval;
  perform private.enqueue_notification(org,primary_id,null,ticket,null,'incident_approval','Workflow decision needs your approval',true,'incident-approval-request:'||target);
  insert into public.incident_approval_history(organization_id,ticket_id,approval_id,actor_id,action,snapshot) values(org,ticket,target,actor,'requested',to_jsonb(approval));return approval.revision;
 elsif operation in ('approve','reject','cancel_approval') then
  select * into approval from public.incident_approvals where id=target and organization_id=org and ticket_id=ticket for update;
  if not found then raise exception 'Approval unavailable' using errcode='42501';end if;
  if approval.revision is distinct from expected_revision or approval.status<>'pending' or approval.superseded_by is not null then raise exception 'Approval request changed' using errcode='PT409';end if;
  if operation='cancel_approval' then
   if not is_manager then raise exception 'Only the coordinator or an administrator can cancel approval' using errcode='42501';end if;
  else
   if actor=approval.requested_by or (actor<>approval.approver_id and not (actor is not distinct from approval.backup_approver_id and approval.due_at<=clock_timestamp())) then raise exception 'Only a designated approver can decide; the backup can act after the deadline' using errcode='42501';end if;
   if approval.step_id is not null then
    select * into step from public.incident_steps where organization_id=org and ticket_id=ticket and id=approval.step_id for update;
    if not found or step.work_version<>approval.step_work_version or step.completed_at is not null then raise exception 'Step changed; request fresh approval' using errcode='PT409';end if;
   end if;
  end if;
  if char_length(trim(coalesce(payload->>'note',''))) not between 3 and 2000 then raise exception 'Record a decision reason with 3–2000 characters';end if;
  update public.incident_approvals set status=case operation when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,decision_by=actor,decided_at=now(),decision_note=trim(payload->>'note'),revision=revision+1 where id=target returning * into approval;
  insert into public.incident_approval_history(organization_id,ticket_id,approval_id,actor_id,action,snapshot) values(org,ticket,target,actor,approval.status,to_jsonb(approval));
  perform private.enqueue_notification(org,approval.requested_by,actor,ticket,null,'incident_approval','Workflow approval decision recorded',true,'incident-approval-decision:'||target||':'||approval.revision);return approval.revision;
 end if;
 raise exception 'Incident control action unavailable';
end $$;

create or replace view private.incident_escalation_candidates with(security_invoker=true) as
with work as (
 select s.organization_id,s.ticket_id,s.id target_id,'acknowledgement_missed'::text reason,
  'ack:'||s.id||':'||s.assignment_token||':'||p.revision event_key,
  coalesce(s.assignment_started_at,s.created_at)+make_interval(mins=>p.acknowledgement_minutes) deadline,
  null::uuid designated_backup,p.backup_owner_id,i.owner_id incident_owner
 from public.incident_steps s join public.incident_escalation_policies p on p.ticket_id=s.ticket_id and p.organization_id=s.organization_id
 join public.ticket_workflows i on i.ticket_id=s.ticket_id and i.organization_id=s.organization_id
 where p.enabled and s.completed_at is null and s.acknowledged_at is null
 union all
 select s.organization_id,s.ticket_id,s.id,'step_overdue',
  'step-due:'||s.id||':'||s.assignment_token||':'||s.due_at||':'||p.revision,
  s.due_at+make_interval(mins=>p.overdue_minutes),null::uuid,p.backup_owner_id,i.owner_id
 from public.incident_steps s join public.incident_escalation_policies p on p.ticket_id=s.ticket_id and p.organization_id=s.organization_id
 join public.ticket_workflows i on i.ticket_id=s.ticket_id and i.organization_id=s.organization_id
 where p.enabled and s.completed_at is null and s.due_at is not null
 union all
 select a.organization_id,a.ticket_id,a.id,'approval_overdue',
  'approval-due:'||a.id||':'||coalesce(p.revision,0),a.due_at+make_interval(mins=>coalesce(p.overdue_minutes,0)),
  a.backup_approver_id,case when p.enabled then p.backup_owner_id else null end,i.owner_id
 from public.incident_approvals a join public.ticket_workflows i on i.ticket_id=a.ticket_id and i.organization_id=a.organization_id
 left join public.incident_escalation_policies p on p.ticket_id=a.ticket_id and p.organization_id=a.organization_id
 where a.status='pending' and a.superseded_by is null
 and (a.step_id is null or exists(select 1 from public.incident_steps s where s.id=a.step_id and s.organization_id=a.organization_id and s.ticket_id=a.ticket_id and s.work_version=a.step_work_version and s.completed_at is null))
 union all
 select c.organization_id,c.ticket_id,c.ticket_id,'communication_overdue',
  'communication-due:'||c.ticket_id||':'||c.revision||':'||p.revision,
  c.next_update_at+make_interval(mins=>p.overdue_minutes),null::uuid,p.backup_owner_id,i.owner_id
 from public.incident_communication_plans c join public.incident_escalation_policies p on p.ticket_id=c.ticket_id and p.organization_id=c.organization_id
 join public.ticket_workflows i on i.ticket_id=c.ticket_id and i.organization_id=c.organization_id
 where p.enabled and c.next_update_at is not null
)
select w.* from work w join public.tickets t on t.id=w.ticket_id and t.organization_id=w.organization_id
where w.deadline<=now() and t.status not in ('resolved','closed')
 and not exists(select 1 from public.incident_escalations e where e.ticket_id=w.ticket_id and e.event_key=w.event_key)
 and exists(select 1 from public.organization_memberships m where m.organization_id=w.organization_id and m.status='active' and m.role in ('administrator','technician') and (m.user_id=any(array[w.designated_backup,w.backup_owner_id,w.incident_owner]) or m.role='administrator'));


create or replace function public.enqueue_incident_escalations() returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; current_work record; recipients uuid[]; recipient uuid; receipt bigint; total integer:=0;
begin
 for candidate in select * from private.incident_escalation_candidates order by deadline,ticket_id,event_key limit 200 loop
  perform 1 from public.ticket_workflows where organization_id=candidate.organization_id and ticket_id=candidate.ticket_id for update skip locked;
  if not found then continue;end if;
  -- Re-evaluate after the coordination lock: acknowledged/completed/superseded
  -- work must not generate a late alert from a previously selected candidate.
  select * into current_work from private.incident_escalation_candidates where organization_id=candidate.organization_id and ticket_id=candidate.ticket_id and event_key=candidate.event_key;
  if not found then continue;end if;
  recipients:=array(select distinct m.user_id from public.organization_memberships m where m.organization_id=candidate.organization_id and m.status='active' and m.role in ('administrator','technician') and m.user_id=any(array[current_work.designated_backup,current_work.backup_owner_id,current_work.incident_owner]) order by m.user_id);
  if cardinality(recipients)=0 then recipients:=array(select m.user_id from public.organization_memberships m where m.organization_id=candidate.organization_id and m.status='active' and m.role='administrator' order by m.user_id limit 20);end if;
  if cardinality(recipients)=0 then continue;end if;
  insert into public.incident_escalations(organization_id,ticket_id,target_id,reason,event_key,recipient_ids)
  values(candidate.organization_id,candidate.ticket_id,current_work.target_id,current_work.reason,current_work.event_key,recipients)
  on conflict(ticket_id,event_key) do nothing returning id into receipt;
  if receipt is not null then
   foreach recipient in array recipients loop
    perform private.enqueue_notification(candidate.organization_id,recipient,null,candidate.ticket_id,null,'incident_escalation',
     case current_work.reason when 'acknowledgement_missed' then 'Response step acknowledgement is overdue' when 'step_overdue' then 'Response step is overdue' when 'approval_overdue' then 'Workflow approval is overdue' else 'Stakeholder communication is overdue' end,
     true,'incident-escalation:'||receipt||':'||recipient);
   end loop;
   total:=total+1;
  end if;
 end loop;
 return total;
end $$;

create table public.workflow_templates (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, kind text not null check(kind in ('incident','maintenance','procedure')), description text not null,
 revision bigint not null default 1, latest_version integer not null default 0,
 archived boolean not null default false, created_by uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id)
);
create index workflow_templates_catalog_idx on public.workflow_templates(organization_id,archived,kind,name,id);
create table public.workflow_template_drafts (
 template_id uuid primary key, organization_id uuid not null, definition jsonb not null,
 updated_at timestamptz not null default now(),
 foreign key(organization_id,template_id) references public.workflow_templates(organization_id,id) on delete cascade
);
create table public.workflow_template_versions (
 organization_id uuid not null, template_id uuid not null, version integer not null,
 definition jsonb not null, change_note text not null, published_by uuid not null, published_at timestamptz not null default now(),
 primary key(organization_id,template_id,version),
 foreign key(organization_id,template_id) references public.workflow_templates(organization_id,id) on delete cascade
);
create table public.ticket_workflow_applications (
 id uuid primary key, organization_id uuid not null, ticket_id uuid not null, template_id uuid not null, template_version integer not null,
 definition_snapshot jsonb not null, assignment_snapshot jsonb not null, fingerprint text not null,
 step_ids uuid[] not null, group_ids uuid[] not null default '{}', applied_by uuid not null,
 applied_at timestamptz not null default now(), unique(ticket_id,template_id),unique(organization_id,id),
 foreign key(ticket_id) references public.ticket_workflows(ticket_id) on delete cascade,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,template_id,template_version) references public.workflow_template_versions(organization_id,template_id,version)
);
create index ticket_workflow_applications_ticket_idx on public.ticket_workflow_applications(organization_id,ticket_id,applied_at,id);
create index ticket_workflow_applications_version_idx on public.ticket_workflow_applications(organization_id,template_id,template_version);
alter table public.incident_steps add column application_id uuid;
alter table public.incident_steps add column procedure_position integer check(procedure_position between 0 and 19);
alter table public.incident_steps add foreign key(organization_id,application_id) references public.ticket_workflow_applications(organization_id,id);
create index incident_steps_application_idx on public.incident_steps(organization_id,application_id) where application_id is not null;
do $$declare name text;begin
 foreach name in array array['workflow_templates','workflow_template_drafts','workflow_template_versions','ticket_workflow_applications'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select on public.%I to authenticated',name);
 end loop;
end $$;
create policy "Staff browse published templates" on public.workflow_templates for select to authenticated using(
 private.can_work_tickets(organization_id) and (select private.has_required_assurance())
 and ((latest_version>0 and not archived) or private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
create policy "Administrators read template drafts" on public.workflow_template_drafts for select to authenticated using(
 private.has_organization_role(organization_id,array['administrator']::public.app_role[]) and (select private.has_required_assurance()));
create policy "Staff read available published versions" on public.workflow_template_versions for select to authenticated using(
 private.can_work_tickets(organization_id) and (select private.has_required_assurance()) and exists(select 1 from public.workflow_templates t where t.organization_id=workflow_template_versions.organization_id and t.id=workflow_template_versions.template_id));
create policy "Staff read pinned procedures" on public.ticket_workflow_applications for select to authenticated using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()));

create function private.validate_workflow_definition(def jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare step jsonb; item jsonb; key text;
begin
 if jsonb_typeof(def) is distinct from 'object' or octet_length(def::text)>131072 or def->'schema_version' is distinct from '1'::jsonb then raise exception 'Invalid procedure definition';end if;
 if exists(select 1 from jsonb_object_keys(def) k where k not in ('schema_version','name','kind','description','steps','communication','escalation')) then raise exception 'Unknown procedure field';end if;
 if jsonb_typeof(def->'name') is distinct from 'string' or char_length(trim(def->>'name')) not between 3 and 100 or coalesce(def->>'kind','') not in ('incident','maintenance','procedure') or jsonb_typeof(def->'description') is distinct from 'string' or char_length(def->>'description')>2000 then raise exception 'Invalid procedure name, kind or description';end if;
 if jsonb_typeof(def->'steps') is distinct from 'array' then raise exception 'Procedure steps must be an array';end if;
 if jsonb_array_length(def->'steps') not between 1 and 20 then raise exception 'Enter 1–20 procedure steps';end if;
 for step in select * from jsonb_array_elements(def->'steps') loop
  if jsonb_typeof(step) is distinct from 'object' or coalesce(step->>'id','')!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' or jsonb_typeof(step->'title') is distinct from 'string' or char_length(trim(step->>'title')) not between 3 and 180 or jsonb_typeof(step->'instructions') is distinct from 'string' or char_length(step->>'instructions')>4000 or coalesce(step->>'assignee','') not in ('owner','backup') or jsonb_typeof(step->'approval_required') is distinct from 'boolean' then raise exception 'Invalid procedure step';end if;
  if exists(select 1 from jsonb_object_keys(step) k where k not in ('id','title','instructions','assignee','due_minutes','approval_required','approval_minutes')) then raise exception 'Unknown procedure step field';end if;
  foreach key in array array['due_minutes','approval_minutes'] loop
   if step->key is not null and step->key<>'null'::jsonb and (jsonb_typeof(step->key)<>'number' or step->>key!~'^[0-9]{1,5}$' or (step->>key)::integer not between 1 and 43200) then raise exception 'Use 1–43200 minutes for relative deadlines';end if;
  end loop;
  if (step->>'approval_required')::boolean and coalesce(step->>'approval_minutes','')='' then raise exception 'Approval steps need a decision deadline';end if;
 end loop;
 if (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(def->'steps') s)<>jsonb_array_length(def->'steps') then raise exception 'Procedure step identifiers must be unique';end if;
 item:=def->'communication';
 if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'guidance') is distinct from 'string' or char_length(item->>'guidance')>4000 or jsonb_typeof(item->'group_names') is distinct from 'array' then raise exception 'Invalid communication guidance';end if;
 if exists(select 1 from jsonb_object_keys(item) k where k not in ('guidance','group_names','next_update_minutes')) then raise exception 'Unknown communication field';end if;
 if item->'next_update_minutes' is not null and item->'next_update_minutes'<>'null'::jsonb and (jsonb_typeof(item->'next_update_minutes')<>'number' or item->>'next_update_minutes'!~'^[0-9]{1,5}$' or (item->>'next_update_minutes')::integer not between 1 and 43200) then raise exception 'Invalid next-update offset';end if;
 if jsonb_array_length(item->'group_names')>10 or exists(select 1 from jsonb_array_elements(item->'group_names') n where jsonb_typeof(n)<>'string' or char_length(trim(n#>>'{}')) not between 2 and 100) then raise exception 'Enter up to 10 stakeholder group names';end if;
 if (select count(distinct lower(trim(n))) from jsonb_array_elements_text(item->'group_names') n)<>jsonb_array_length(item->'group_names') then raise exception 'Stakeholder group names must be unique';end if;
 item:=def->'escalation';
 if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'enabled') is distinct from 'boolean' or jsonb_typeof(item->'acknowledgement_minutes') is distinct from 'number' or jsonb_typeof(item->'overdue_minutes') is distinct from 'number' or coalesce(item->>'acknowledgement_minutes','')!~'^[0-9]{1,4}$' or coalesce(item->>'overdue_minutes','')!~'^[0-9]{1,4}$' or (item->>'acknowledgement_minutes')::integer not between 1 and 1440 or (item->>'overdue_minutes')::integer not between 0 and 1440 then raise exception 'Invalid escalation times';end if;
 if exists(select 1 from jsonb_object_keys(item) k where k not in ('enabled','acknowledgement_minutes','overdue_minutes')) then raise exception 'Unknown escalation field';end if;
end $$;
revoke all on function private.validate_workflow_definition(jsonb) from public,anon,authenticated;

create function private.manage_workflow_template(org uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare template public.workflow_templates; definition jsonb; next_version integer;
begin
 if auth.uid() is null or not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) or not private.has_required_assurance() then raise exception 'Template administration denied' using errcode='42501';end if;
 select * into template from public.workflow_templates where organization_id=org and id=target for update;
 if coalesce(template.revision,0) is distinct from expected_revision then raise exception 'Template changed; review saved draft' using errcode='PT409';end if;
 if operation='save' then
  definition:=payload->'definition';perform private.validate_workflow_definition(definition);
  if template.id is null then
   insert into public.workflow_templates(id,organization_id,name,kind,description,created_by) values(target,org,trim(definition->>'name'),definition->>'kind',definition->>'description',auth.uid()) returning * into template;
   insert into public.workflow_template_drafts values(target,org,definition,now());
  else
   if template.archived then raise exception 'Restore the template before editing';end if;
   update public.workflow_templates set name=case when latest_version=0 then trim(definition->>'name') else name end,kind=case when latest_version=0 then definition->>'kind' else kind end,description=case when latest_version=0 then definition->>'description' else description end,revision=revision+1,updated_at=now() where id=target returning * into template;
   update public.workflow_template_drafts set definition=payload->'definition',updated_at=now() where template_id=target and organization_id=org;
  end if;
 elsif operation='publish' then
  if template.id is null or template.archived then raise exception 'Template unavailable';end if;
  if char_length(trim(coalesce(payload->>'change_note',''))) not between 3 and 1000 then raise exception 'Describe this version in 3–1000 characters';end if;
  select d.definition into definition from public.workflow_template_drafts d where d.template_id=target and d.organization_id=org;
  perform private.validate_workflow_definition(definition);next_version:=template.latest_version+1;
  insert into public.workflow_template_versions values(org,target,next_version,definition,trim(payload->>'change_note'),auth.uid(),now());
  update public.workflow_templates set name=trim(definition->>'name'),kind=definition->>'kind',description=definition->>'description',latest_version=next_version,revision=revision+1,updated_at=now() where id=target returning * into template;
 elsif operation in ('archive','restore') then
  if template.id is null then raise exception 'Template unavailable';end if;
  update public.workflow_templates set archived=(operation='archive'),revision=revision+1,updated_at=now() where id=target returning * into template;
 else raise exception 'Template action unavailable';end if;
 return template.revision;
end $$;
revoke all on function private.manage_workflow_template(uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function private.manage_workflow_template(uuid,uuid,bigint,text,jsonb) to authenticated;
create function public.manage_workflow_template(org uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language sql security invoker set search_path='' as $$select private.manage_workflow_template(org,target,expected_revision,operation,payload)$$;
revoke all on function public.manage_workflow_template(uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.manage_workflow_template(uuid,uuid,bigint,text,jsonb) to authenticated;

create function private.guard_procedure_step_provenance() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if row(new.application_id,new.procedure_position) is distinct from row(old.application_id,old.procedure_position) then raise exception 'Procedure origin cannot change';end if;
 elsif new.application_id is not null then
  if not exists(select 1 from public.ticket_workflow_applications a where a.organization_id=new.organization_id and a.ticket_id=new.ticket_id and a.id=new.application_id and a.step_ids[new.procedure_position+1]=new.id) then raise exception 'Procedure step origin unavailable' using errcode='42501';end if;
 elsif new.procedure_position is not null then raise exception 'A procedure position requires its origin';end if;
 return new;
end $$;
revoke all on function private.guard_procedure_step_provenance() from public,anon,authenticated;
create trigger incident_steps_template_provenance before insert or update on public.incident_steps for each row execute function private.guard_procedure_step_provenance();

create function private.apply_workflow_template(org uuid,ticket uuid,template_id uuid,version integer,token uuid,expected_ticket_revision bigint,payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare workflow public.ticket_workflows; base_ticket public.tickets; template public.workflow_templates;
 existing public.ticket_workflow_applications; definition jsonb; owner uuid; backup uuid; approver uuid;
 fingerprint text; applied_at timestamptz; ids uuid[]; groups uuid[]:='{}'; group_id uuid;
 step jsonb; step_id uuid; item text; position integer:=0; requires_approval boolean; deadline timestamptz; admin boolean;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Workflow access denied' using errcode='42501';end if;
 owner:=(payload->>'owner_id')::uuid;backup:=nullif(payload->>'backup_id','')::uuid;approver:=nullif(payload->>'approver_id','')::uuid;
 fingerprint:=md5(jsonb_build_object('ticket',ticket,'template',template_id,'version',version,'owner',owner,'backup',backup,'approver',approver)::text);
 select * into workflow from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 select * into base_ticket from public.tickets where organization_id=org and id=ticket for update;
 if not found or base_ticket.request_kind<>'support' then raise exception 'Choose a support ticket in this company' using errcode='42501';end if;
 -- Read the receipt after locking the ticket. Retries preserve the exact original
 -- version and assignments, even after the template or coordination changes.
 select * into existing from public.ticket_workflow_applications a where a.organization_id=org and a.ticket_id=ticket and (a.id=token or a.template_id=$3);
 if found then
  if existing.fingerprint=fingerprint then return existing.id;end if;
  raise exception 'This procedure is already applied; review its pinned version' using errcode='PT409';
 end if;
 if expected_ticket_revision is null or base_ticket.revision<>expected_ticket_revision then raise exception 'Ticket changed; review before applying' using errcode='PT409';end if;
 if base_ticket.status in ('resolved','closed') then raise exception 'Reopen the ticket before applying a procedure';end if;
 admin:=coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false);
 if workflow.ticket_id is not null then
  if workflow.owner_id<>auth.uid() and not admin then raise exception 'Only the coordinator or an administrator can apply a procedure' using errcode='42501';end if;
  if owner is distinct from workflow.owner_id then raise exception 'Coordinator changed; review before applying' using errcode='PT409';end if;
 elsif owner<>auth.uid() and not admin then raise exception 'Only administrators can choose a different coordinator' using errcode='42501';end if;
 select * into template from public.workflow_templates t where t.organization_id=org and t.id=$3 for share;
 if not found or template.archived or template.latest_version<>version or version<1 then raise exception 'Published template changed or is unavailable' using errcode='PT409';end if;
 select v.definition into definition from public.workflow_template_versions v where v.organization_id=org and v.template_id=$3 and v.version=$4;
 perform private.validate_workflow_definition(definition);
 if definition->>'kind'='incident' and (workflow.ticket_id is null or workflow.kind<>'incident') then raise exception 'Declare an incident before applying an incident procedure';end if;
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=owner and status='active' and role in ('administrator','technician')) then raise exception 'Choose an active coordinator';end if;
 if backup is not null and (backup=owner or not exists(select 1 from public.organization_memberships where organization_id=org and user_id=backup and status='active' and role in ('administrator','technician'))) then raise exception 'Choose a different active backup';end if;
 if exists(select 1 from public.incident_escalation_policies p where p.organization_id=org and p.ticket_id=ticket and p.backup_owner_id is not null and p.backup_owner_id is distinct from backup) then raise exception 'Backup coordinator changed; review the current escalation plan' using errcode='PT409';end if;
 if approver is not null and not exists(select 1 from public.organization_memberships where organization_id=org and user_id=approver and status='active' and role in ('administrator','technician')) then raise exception 'Choose an active company approver';end if;
 if ((definition#>>'{escalation,enabled}')::boolean or exists(select 1 from jsonb_array_elements(definition->'steps') s where s->>'assignee'='backup')) and backup is null then raise exception 'This procedure needs a backup owner';end if;
 requires_approval:=exists(select 1 from jsonb_array_elements(definition->'steps') s where (s->>'approval_required')::boolean);
 if requires_approval and (approver is null or approver=auth.uid() or not exists(select 1 from public.organization_memberships where organization_id=org and user_id=approver and status='active' and role in ('administrator','technician'))) then raise exception 'Choose another active staff member to approve the work';end if;
 if (select count(*) from public.ticket_workflow_applications where ticket_id=ticket)>=5 then raise exception 'Up to five procedures per ticket';end if;
 if (select count(*) from public.incident_steps where ticket_id=ticket)+jsonb_array_length(definition->'steps')>100 then raise exception 'Procedure would exceed 100 response steps';end if;
 if (select count(*) from public.incident_approvals where ticket_id=ticket and status='pending' and superseded_by is null)+(select count(*) from jsonb_array_elements(definition->'steps') s where (s->>'approval_required')::boolean)>20 then raise exception 'Procedure would exceed 20 pending approvals';end if;
 if workflow.ticket_id is null then
  insert into public.ticket_workflows(ticket_id,organization_id,kind,owner_id) values(ticket,org,definition->>'kind',owner);
 end if;
 ids:=array(select gen_random_uuid() from jsonb_array_elements(definition->'steps'));
 applied_at:=clock_timestamp();
 insert into public.ticket_workflow_applications(id,organization_id,ticket_id,template_id,template_version,definition_snapshot,assignment_snapshot,fingerprint,step_ids,applied_by,applied_at)
 values(token,org,ticket,$3,version,definition,jsonb_build_object('owner_id',owner,'backup_id',backup,'approver_id',approver),fingerprint,ids,auth.uid(),applied_at);
 for step in select * from jsonb_array_elements(definition->'steps') loop
  step_id:=ids[position+1];deadline:=case when step->>'due_minutes' is null then null else applied_at+make_interval(mins=>(step->>'due_minutes')::integer) end;
  insert into public.incident_steps(id,organization_id,ticket_id,title,instructions,assignee_id,due_at,application_id,procedure_position)
  values(step_id,org,ticket,step->>'title',step->>'instructions',case when step->>'assignee'='backup' then backup else owner end,deadline,token,position);
  if (step->>'approval_required')::boolean then
   perform private.manage_incident_control(org,ticket,gen_random_uuid(),0,'request_approval',jsonb_build_object('title',step->>'title','description',case when char_length(trim(step->>'instructions'))>=3 then step->>'instructions' else 'Review and approve this response step.' end,'step_id',step_id,'approver_id',approver,'backup_approver_id',case when backup<>approver and backup<>auth.uid() then backup else null end,'due_at',applied_at+make_interval(mins=>(step->>'approval_minutes')::integer)));
  end if;
  position:=position+1;
 end loop;
 -- Preserve existing settings. New procedures add work rather than replacing a
 -- live communication plan, escalation policy or previously completed checklist.
 if not exists(select 1 from public.incident_escalation_policies where ticket_id=ticket) then
  perform private.manage_incident_control(org,ticket,ticket,0,'save_policy',jsonb_build_object('backup_owner_id',backup,'enabled',(definition#>>'{escalation,enabled}')::boolean,'acknowledgement_minutes',(definition#>>'{escalation,acknowledgement_minutes}')::integer,'overdue_minutes',(definition#>>'{escalation,overdue_minutes}')::integer));
 end if;
 if not exists(select 1 from public.incident_communication_plans where ticket_id=ticket) then
  perform private.manage_incident_communication(org,ticket,ticket,0,'save_plan',jsonb_build_object('owner_id',owner,'next_update_at',case when definition#>>'{communication,next_update_minutes}' is null then null else applied_at+make_interval(mins=>(definition#>>'{communication,next_update_minutes}')::integer) end));
 end if;
 for item in select * from jsonb_array_elements_text(definition#>'{communication,group_names}') loop
  group_id:=null;
  select g.id into group_id from public.incident_stakeholder_groups g where g.organization_id=org and g.ticket_id=ticket and not g.archived and lower(trim(g.name))=lower(trim(item)) order by g.created_at,g.id limit 1;
  if group_id is null then
   group_id:=gen_random_uuid();perform private.manage_incident_communication(org,ticket,group_id,0,'save_group',jsonb_build_object('name',item));
  end if;
  groups:=array_append(groups,group_id);
 end loop;
 update public.ticket_workflow_applications set group_ids=groups where id=token;
 return token;
end $$;
revoke all on function private.apply_workflow_template(uuid,uuid,uuid,integer,uuid,bigint,jsonb) from public,anon;
grant execute on function private.apply_workflow_template(uuid,uuid,uuid,integer,uuid,bigint,jsonb) to authenticated;
create function public.apply_workflow_template(org uuid,ticket uuid,template_id uuid,version integer,token uuid,expected_ticket_revision bigint,payload jsonb)
returns uuid language sql security invoker set search_path='' as $$select private.apply_workflow_template(org,ticket,template_id,version,token,expected_ticket_revision,payload)$$;
revoke all on function public.apply_workflow_template(uuid,uuid,uuid,integer,uuid,bigint,jsonb) from public,anon;
grant execute on function public.apply_workflow_template(uuid,uuid,uuid,integer,uuid,bigint,jsonb) to authenticated;
