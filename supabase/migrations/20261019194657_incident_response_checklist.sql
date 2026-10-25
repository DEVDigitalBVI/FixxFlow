-- Staff-only response work; ticket status and employee-visible activity stay unchanged.
create table public.incident_steps (
 id uuid primary key, organization_id uuid not null, ticket_id uuid not null,
 title text not null check(char_length(trim(title)) between 3 and 180),
 instructions text not null default '' check(char_length(instructions)<=4000),
 assignee_id uuid not null, due_at timestamptz check(due_at is null or isfinite(due_at)),
 acknowledged_at timestamptz, completed_at timestamptz,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(ticket_id) references public.ticket_incidents(ticket_id) on delete cascade,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,assignee_id) references public.organization_memberships(organization_id,user_id)
);
create index incident_steps_ticket_idx on public.incident_steps(organization_id,ticket_id,created_at,id);
create index incident_steps_assignee_idx on public.incident_steps(organization_id,assignee_id);
create table public.incident_step_history (
 id bigint generated always as identity primary key, organization_id uuid not null,
 step_id uuid not null references public.incident_steps(id) on delete cascade,
 ticket_id uuid not null, actor_id uuid not null, action text not null,
 snapshot jsonb not null, created_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
create index incident_step_history_ticket_idx on public.incident_step_history(organization_id,ticket_id,id desc);
create index incident_step_history_step_idx on public.incident_step_history(step_id);
alter table public.incident_steps enable row level security;
alter table public.incident_step_history enable row level security;
revoke all on public.incident_steps,public.incident_step_history from public,anon,authenticated;
grant select,insert,update on public.incident_steps to authenticated;
grant select on public.incident_step_history to authenticated;
create policy "Staff coordinate response steps" on public.incident_steps for all to authenticated
 using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()))
 with check(private.can_work_tickets(organization_id) and (select private.has_required_assurance()));
create policy "Staff read response history" on public.incident_step_history for select to authenticated
 using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()));

create function private.validate_incident_step() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501'; end if;
 -- Serializes additions and validates the tenant against the actual incident.
 perform 1 from public.ticket_incidents where organization_id=new.organization_id and ticket_id=new.ticket_id for update;
 if not found then raise exception 'Incident unavailable' using errcode='42501'; end if;
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
revoke all on function private.validate_incident_step() from public,anon,authenticated;
create trigger incident_steps_validate before insert or update on public.incident_steps for each row execute function private.validate_incident_step();

-- Private audit trigger owns immutable history writes, matching the incident audit pattern.
create function private.record_incident_step() returns trigger language plpgsql security definer set search_path='' as $$
declare change text;
begin
 if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501'; end if;
 if tg_op='INSERT' then change:='added';
 elsif old.completed_at is not null and new.completed_at is null then change:='reopened';
 elsif new.completed_at is distinct from old.completed_at then change:='completed';
 elsif new.assignee_id<>old.assignee_id then change:='reassigned';
 elsif new.acknowledged_at is distinct from old.acknowledged_at then change:='acknowledged';
 else change:='edited'; end if;
 insert into public.incident_step_history(organization_id,step_id,ticket_id,actor_id,action,snapshot)
 values(new.organization_id,new.id,new.ticket_id,auth.uid(),change,to_jsonb(new));
 return new;
end $$;
revoke all on function private.record_incident_step() from public,anon,authenticated;
create trigger incident_steps_history after insert or update on public.incident_steps for each row execute function private.record_incident_step();

create function public.change_incident_step(org uuid,ticket uuid,step uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare saved public.incident_steps; result bigint;
begin
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Step access denied' using errcode='42501'; end if;
 perform 1 from public.ticket_incidents where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Incident unavailable' using errcode='42501'; end if;
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
revoke all on function public.change_incident_step(uuid,uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.change_incident_step(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;
