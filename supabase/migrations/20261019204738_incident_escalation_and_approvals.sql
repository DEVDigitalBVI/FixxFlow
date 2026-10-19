-- Coordination stays staff-only; approvals do not change ticket status or send
-- stakeholder updates. Protected commands own all decisions and escalation receipts.
create table public.incident_escalation_policies (
 ticket_id uuid primary key references public.ticket_incidents(ticket_id) on delete cascade,
 organization_id uuid not null, backup_owner_id uuid, enabled boolean not null default true,
 acknowledgement_minutes integer not null default 30 check(acknowledgement_minutes between 1 and 1440),
 overdue_minutes integer not null default 15 check(overdue_minutes between 0 and 1440),
 revision bigint not null default 1, updated_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,backup_owner_id) references public.organization_memberships(organization_id,user_id)
);
create index incident_escalation_policies_backup_idx on public.incident_escalation_policies(organization_id,backup_owner_id);
alter table public.incident_steps add column work_version bigint not null default 1;
alter table public.incident_steps add column assignment_token uuid not null default gen_random_uuid();
alter table public.incident_steps add column assignment_started_at timestamptz;
alter table public.incident_steps alter column assignment_started_at set default now();
create table public.incident_approvals (
 id uuid primary key, organization_id uuid not null, ticket_id uuid not null,
 step_id uuid references public.incident_steps(id) on delete cascade, step_work_version bigint, step_snapshot jsonb,
 title text not null check(char_length(trim(title)) between 3 and 180),
 description text not null check(char_length(trim(description)) between 3 and 4000),
 approver_id uuid not null, backup_approver_id uuid, due_at timestamptz not null check(isfinite(due_at)),
 requested_by uuid not null, requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 decision_by uuid, decided_at timestamptz, decision_note text check(char_length(decision_note)<=2000),
 superseded_by uuid references public.incident_approvals(id) deferrable initially deferred,
 revision bigint not null default 1,
 foreign key(ticket_id) references public.ticket_incidents(ticket_id) on delete cascade,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,approver_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,backup_approver_id) references public.organization_memberships(organization_id,user_id),
 check(approver_id<>requested_by and (backup_approver_id is null or (backup_approver_id<>approver_id and backup_approver_id<>requested_by))),
 check((step_id is null)=(step_work_version is null) and (step_id is null)=(step_snapshot is null))
);
create index incident_approvals_ticket_idx on public.incident_approvals(organization_id,ticket_id,requested_at desc,id desc);
create index incident_approvals_approver_idx on public.incident_approvals(organization_id,approver_id);
create index incident_approvals_backup_idx on public.incident_approvals(organization_id,backup_approver_id);
create index incident_approvals_superseded_idx on public.incident_approvals(superseded_by);
create unique index incident_approvals_current_step_idx on public.incident_approvals(step_id) where step_id is not null and superseded_by is null and status<>'cancelled';
create index incident_approvals_due_idx on public.incident_approvals(due_at,id) where status='pending' and superseded_by is null;
create table public.incident_approval_history (
 id bigint generated always as identity primary key, organization_id uuid not null, ticket_id uuid not null,
 approval_id uuid not null references public.incident_approvals(id) on delete cascade,
 actor_id uuid not null, action text not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
create index incident_approval_history_ticket_idx on public.incident_approval_history(organization_id,ticket_id,id desc);
create index incident_approval_history_request_idx on public.incident_approval_history(approval_id);
create table public.incident_escalations (
 id bigint generated always as identity primary key, organization_id uuid not null, ticket_id uuid not null,
 target_id uuid not null, reason text not null, event_key text not null,
 recipient_ids uuid[] not null, created_at timestamptz not null default now(),
 unique(ticket_id,event_key),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
create index incident_escalations_ticket_idx on public.incident_escalations(organization_id,ticket_id,id desc);
create table public.incident_control_history (
 id bigint generated always as identity primary key, organization_id uuid not null, ticket_id uuid not null,
 actor_id uuid not null, action text not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
create index incident_control_history_ticket_idx on public.incident_control_history(organization_id,ticket_id,id desc);
do $$declare name text;begin
 foreach name in array array['incident_escalation_policies','incident_approvals','incident_approval_history','incident_escalations','incident_control_history'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select on public.%I to authenticated',name);
  execute format('create policy "Staff read incident control" on public.%I for select to authenticated using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()))',name);
 end loop;
end $$;

-- Runs after the existing validator, before history. Clients cannot choose the
-- work version or assignment episode, even through direct table writes.
create function private.guard_incident_step_workflow() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.work_version:=1;new.assignment_started_at:=now();new.assignment_token:=gen_random_uuid();
 else
  new.work_version:=old.work_version;new.assignment_started_at:=coalesce(old.assignment_started_at,old.created_at);new.assignment_token:=old.assignment_token;
  if row(new.title,new.instructions,new.assignee_id,new.due_at) is distinct from row(old.title,old.instructions,old.assignee_id,old.due_at) or (old.completed_at is not null and new.completed_at is null) then new.work_version:=old.work_version+1;end if;
  if new.assignee_id<>old.assignee_id or (old.completed_at is not null and new.completed_at is null) then new.assignment_started_at:=now();new.assignment_token:=gen_random_uuid();end if;
  if new.completed_at is not null and old.completed_at is null and exists(select 1 from public.incident_approvals a where a.organization_id=new.organization_id and a.ticket_id=new.ticket_id and a.step_id=new.id and a.superseded_by is null and a.status<>'cancelled') then
   if not exists(select 1 from public.incident_approvals a where a.organization_id=new.organization_id and a.ticket_id=new.ticket_id and a.step_id=new.id and a.step_work_version=new.work_version and a.superseded_by is null and a.status='approved') then
    raise exception 'Approval required for the current step details' using errcode='PT422';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_incident_step_workflow() from public,anon,authenticated;
create trigger incident_steps_workflow_validate before insert or update on public.incident_steps for each row execute function private.guard_incident_step_workflow();
create function private.notify_incident_step_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501';end if;
 if tg_op='INSERT' or new.assignment_token is distinct from old.assignment_token then
  perform private.enqueue_notification(new.organization_id,new.assignee_id,null,new.ticket_id,null,'incident_step_assigned','Response step needs your acknowledgement',true,'incident-step-assigned:'||new.id||':'||new.assignment_token);
 end if;
 return new;
end $$;
revoke all on function private.notify_incident_step_assignment() from public,anon,authenticated;
create trigger incident_steps_workflow_notify after insert or update on public.incident_steps for each row execute function private.notify_incident_step_assignment();

create function private.manage_incident_control(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare incident public.ticket_incidents; policy public.incident_escalation_policies; approval public.incident_approvals; previous public.incident_approvals;
 step public.incident_steps; actor uuid:=auth.uid(); primary_id uuid; backup_id uuid; result bigint; is_manager boolean; ticket_revision bigint;
begin
 if actor is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident control access denied' using errcode='42501';end if;
 -- Ownership changes follow the existing ticket -> incident lock order.
 if operation='take_over' then select revision into ticket_revision from public.tickets where organization_id=org and id=ticket for update;end if;
 select * into incident from public.ticket_incidents where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Incident unavailable' using errcode='42501';end if;
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident control access denied' using errcode='42501';end if;
 is_manager:=incident.owner_id=actor or exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=actor and m.status='active' and m.role='administrator');
 select * into policy from public.incident_escalation_policies where ticket_id=ticket;
 if operation='save_policy' then
  if not is_manager then raise exception 'Only the incident owner or an administrator can change escalation' using errcode='42501';end if;
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
  perform public.save_ticket_incident(org,ticket,ticket_revision,jsonb_build_object('severity',incident.severity,'business_impact',incident.business_impact,'owner_id',actor,'affected_services',incident.affected_services,'affected_locations',incident.affected_locations));
  backup_id:=case when exists(select 1 from public.organization_memberships where organization_id=org and user_id=incident.owner_id and status='active' and role in ('administrator','technician')) then incident.owner_id else null end;
  update public.incident_escalation_policies set backup_owner_id=backup_id,enabled=enabled and backup_id is not null,revision=revision+1,updated_at=now() where ticket_id=ticket returning revision into result;
  perform private.enqueue_notification(org,incident.owner_id,actor,ticket,null,'incident_escalation','Incident backup has taken over coordination',true,'incident-takeover:'||ticket||':'||result);
  insert into public.incident_control_history(organization_id,ticket_id,actor_id,action,snapshot) values(org,ticket,actor,'incident_taken_over',jsonb_build_object('previous_owner_id',incident.owner_id,'owner_id',actor,'backup_owner_id',backup_id));
  return result;
 elsif operation='request_approval' then
  if not is_manager then raise exception 'Only the incident owner or an administrator can request approvals' using errcode='42501';end if;
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
  perform private.enqueue_notification(org,primary_id,null,ticket,null,'incident_approval','Incident decision needs your approval',true,'incident-approval-request:'||target);
  insert into public.incident_approval_history(organization_id,ticket_id,approval_id,actor_id,action,snapshot) values(org,ticket,target,actor,'requested',to_jsonb(approval));return approval.revision;
 elsif operation in ('approve','reject','cancel_approval') then
  select * into approval from public.incident_approvals where id=target and organization_id=org and ticket_id=ticket for update;
  if not found then raise exception 'Approval unavailable' using errcode='42501';end if;
  if approval.revision is distinct from expected_revision or approval.status<>'pending' or approval.superseded_by is not null then raise exception 'Approval request changed' using errcode='PT409';end if;
  if operation='cancel_approval' then
   if not is_manager then raise exception 'Only the incident owner or an administrator can cancel approval' using errcode='42501';end if;
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
  perform private.enqueue_notification(org,approval.requested_by,actor,ticket,null,'incident_approval','Incident approval decision recorded',true,'incident-approval-decision:'||target||':'||approval.revision);return approval.revision;
 end if;
 raise exception 'Incident control action unavailable';
end $$;
revoke all on function private.manage_incident_control(uuid,uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function private.manage_incident_control(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;
create function public.manage_incident_control(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language sql security invoker set search_path='' as $$select private.manage_incident_control(org,ticket,target,expected_revision,operation,payload)$$;
revoke all on function public.manage_incident_control(uuid,uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.manage_incident_control(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;

create view private.incident_escalation_candidates with(security_invoker=true) as
with work as (
 select s.organization_id,s.ticket_id,s.id target_id,'acknowledgement_missed'::text reason,
  'ack:'||s.id||':'||s.assignment_token||':'||p.revision event_key,
  coalesce(s.assignment_started_at,s.created_at)+make_interval(mins=>p.acknowledgement_minutes) deadline,
  null::uuid designated_backup,p.backup_owner_id,i.owner_id incident_owner
 from public.incident_steps s join public.incident_escalation_policies p on p.ticket_id=s.ticket_id and p.organization_id=s.organization_id
 join public.ticket_incidents i on i.ticket_id=s.ticket_id and i.organization_id=s.organization_id
 where p.enabled and s.completed_at is null and s.acknowledged_at is null
 union all
 select s.organization_id,s.ticket_id,s.id,'step_overdue',
  'step-due:'||s.id||':'||s.assignment_token||':'||s.due_at||':'||p.revision,
  s.due_at+make_interval(mins=>p.overdue_minutes),null::uuid,p.backup_owner_id,i.owner_id
 from public.incident_steps s join public.incident_escalation_policies p on p.ticket_id=s.ticket_id and p.organization_id=s.organization_id
 join public.ticket_incidents i on i.ticket_id=s.ticket_id and i.organization_id=s.organization_id
 where p.enabled and s.completed_at is null and s.due_at is not null
 union all
 select a.organization_id,a.ticket_id,a.id,'approval_overdue',
  'approval-due:'||a.id||':'||coalesce(p.revision,0),a.due_at+make_interval(mins=>coalesce(p.overdue_minutes,0)),
  a.backup_approver_id,case when p.enabled then p.backup_owner_id else null end,i.owner_id
 from public.incident_approvals a join public.ticket_incidents i on i.ticket_id=a.ticket_id and i.organization_id=a.organization_id
 left join public.incident_escalation_policies p on p.ticket_id=a.ticket_id and p.organization_id=a.organization_id
 where a.status='pending' and a.superseded_by is null
 and (a.step_id is null or exists(select 1 from public.incident_steps s where s.id=a.step_id and s.organization_id=a.organization_id and s.ticket_id=a.ticket_id and s.work_version=a.step_work_version and s.completed_at is null))
 union all
 select c.organization_id,c.ticket_id,c.ticket_id,'communication_overdue',
  'communication-due:'||c.ticket_id||':'||c.revision||':'||p.revision,
  c.next_update_at+make_interval(mins=>p.overdue_minutes),null::uuid,p.backup_owner_id,i.owner_id
 from public.incident_communication_plans c join public.incident_escalation_policies p on p.ticket_id=c.ticket_id and p.organization_id=c.organization_id
 join public.ticket_incidents i on i.ticket_id=c.ticket_id and i.organization_id=c.organization_id
 where p.enabled and c.next_update_at is not null
)
select w.* from work w join public.tickets t on t.id=w.ticket_id and t.organization_id=w.organization_id
where w.deadline<=now() and t.status not in ('resolved','closed')
 and not exists(select 1 from public.incident_escalations e where e.ticket_id=w.ticket_id and e.event_key=w.event_key)
 and exists(select 1 from public.organization_memberships m where m.organization_id=w.organization_id and m.status='active' and m.role in ('administrator','technician') and (m.user_id=any(array[w.designated_backup,w.backup_owner_id,w.incident_owner]) or m.role='administrator'));
revoke all on private.incident_escalation_candidates from public,anon,authenticated;

create function public.enqueue_incident_escalations() returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; current_work record; recipients uuid[]; recipient uuid; receipt bigint; total integer:=0;
begin
 for candidate in select * from private.incident_escalation_candidates order by deadline,ticket_id,event_key limit 200 loop
  perform 1 from public.ticket_incidents where organization_id=candidate.organization_id and ticket_id=candidate.ticket_id for update skip locked;
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
     case current_work.reason when 'acknowledgement_missed' then 'Response step acknowledgement is overdue' when 'step_overdue' then 'Incident response step is overdue' when 'approval_overdue' then 'Incident approval is overdue' else 'Stakeholder communication is overdue' end,
     true,'incident-escalation:'||receipt||':'||recipient);
   end loop;
   total:=total+1;
  end if;
 end loop;
 return total;
end $$;
revoke all on function public.enqueue_incident_escalations() from public,anon,authenticated;
grant execute on function public.enqueue_incident_escalations() to service_role;
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('fixxflow-incident-escalations','* * * * *','select public.enqueue_incident_escalations()');end if;
end $$;
