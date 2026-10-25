-- Apply before deploying the app queue/type changes.
-- Step 1: incident coordination extends an existing ticket. Workflow/status engines stay unchanged.
alter table public.tickets add column ticket_type text not null default 'support'
  check (ticket_type in ('support','incident'));
alter table public.tickets add column incident_revision bigint not null default 0 check(incident_revision>=0);
revoke insert(ticket_type,incident_revision),update(ticket_type,incident_revision) on public.tickets from anon,authenticated;
create index tickets_incident_queue_idx on public.tickets(organization_id,ticket_type,updated_at desc,id desc);

create or replace function private.prepare_ticket_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.revision:=1;
  elsif row(new.title,new.description,new.requester_id,new.assigned_technician_id,new.team_id,new.category_id,new.subcategory_id,new.priority,new.status,new.location_id,new.due_at,new.first_response_at,new.resolved_at,new.closed_at,new.response_sla_due_at,new.resolution_sla_due_at,new.routing_mode,new.ticket_type,new.incident_revision)
    is distinct from row(old.title,old.description,old.requester_id,old.assigned_technician_id,old.team_id,old.category_id,old.subcategory_id,old.priority,old.status,old.location_id,old.due_at,old.first_response_at,old.resolved_at,old.closed_at,old.response_sla_due_at,old.resolution_sla_due_at,old.routing_mode,old.ticket_type,old.incident_revision)
  then new.revision:=old.revision+1;
  else new.revision:=old.revision; end if;
  return new;
end $$;

create table public.ticket_incidents (
  ticket_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  severity text not null check (severity in ('critical','major','moderate','minor')),
  business_impact text not null check (char_length(trim(business_impact)) between 3 and 4000),
  owner_id uuid not null,
  affected_services text[] not null default '{}',
  affected_locations text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
  foreign key (organization_id,owner_id) references public.organization_memberships(organization_id,user_id),
  check (cardinality(affected_services)<=30 and cardinality(affected_locations)<=30)
);
create index ticket_incidents_owner_idx on public.ticket_incidents(organization_id,owner_id);
alter table public.ticket_incidents enable row level security;
revoke all on public.ticket_incidents from public,anon,authenticated;
grant select,insert,update on public.ticket_incidents to authenticated;
create policy "Workers coordinate incidents in their organization" on public.ticket_incidents
  for all to authenticated using (private.can_work_tickets(organization_id) and (select private.has_required_assurance()))
  with check (private.can_work_tickets(organization_id) and (select private.has_required_assurance()));

create function private.validate_ticket_incident() returns trigger
language plpgsql security invoker set search_path='' as $$
declare item text; kind text;
begin
  if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then
    raise exception 'Incident access denied' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.organization_id<>old.organization_id or new.ticket_id<>old.ticket_id) then
    raise exception 'Incident identity cannot change';
  end if;
  select t.request_kind into kind from public.tickets t where t.id=new.ticket_id and t.organization_id=new.organization_id for update;
  if not found or kind<>'support' then raise exception 'Choose a support ticket in this organization'; end if;
  if not exists(select 1 from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id=new.owner_id and m.status='active' and m.role in ('administrator','technician')) then
    raise exception 'Choose an active incident owner';
  end if;
  foreach item in array new.affected_services || new.affected_locations loop
    if item is null or char_length(trim(item)) not between 1 and 120 then raise exception 'Affected names must contain 1–120 characters'; end if;
  end loop;
  new.updated_at:=now();
  if tg_op='UPDATE' then new.created_at:=old.created_at; else new.created_at:=now(); end if;
  return new;
end $$;
create trigger ticket_incidents_validate before insert or update on public.ticket_incidents
 for each row execute function private.validate_ticket_incident();

-- Classification is derived from the coordination record, including direct API writes.
create function private.guard_incident_classification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.ticket_type<>'support' then raise exception 'Declare incidents through their coordination record'; end if;
  elsif new.ticket_type is distinct from old.ticket_type then
    if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Incident access denied' using errcode='42501'; end if;
    if (new.ticket_type='incident') is distinct from exists(select 1 from public.ticket_incidents i where i.organization_id=new.organization_id and i.ticket_id=new.id) then
      raise exception 'Incident classification must match its coordination record';
    end if;
  end if;
  return new;
end $$;
create trigger tickets_incident_classification before insert or update of ticket_type on public.tickets
 for each row execute function private.guard_incident_classification();

-- Match existing private audit-trigger practice. This trigger is not a callable API;
-- incident contents remain in the worker-only table, never in employee-visible activity.
create function private.record_incident_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(private.can_work_tickets(new.organization_id),false) or not private.has_required_assurance() then raise exception 'Incident access denied' using errcode='42501'; end if;
  update public.tickets set ticket_type='incident',incident_revision=incident_revision+1 where organization_id=new.organization_id and id=new.ticket_id;
  insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details)
  values(new.organization_id,new.ticket_id,auth.uid(),case when tg_op='INSERT' then 'incident_declared' else 'incident_updated' end,'{}');
  return new;
end $$;
revoke all on function private.record_incident_change() from public,anon,authenticated;
create trigger ticket_incidents_record after insert or update on public.ticket_incidents
 for each row execute function private.record_incident_change();

create function public.save_ticket_incident(org uuid,target uuid,expected_revision bigint,payload jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; result bigint;
begin
  if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident access denied' using errcode='42501'; end if;
  select t.revision into current_revision from public.tickets t where t.id=target and t.organization_id=org for update;
  if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
  if expected_revision is null or current_revision<>expected_revision then raise exception 'Ticket changed; review saved details' using errcode='PT409'; end if;
  if jsonb_typeof(payload)<>'object' then raise exception 'Invalid incident details'; end if;
  insert into public.ticket_incidents(ticket_id,organization_id,severity,business_impact,owner_id,affected_services,affected_locations)
  values(target,org,payload->>'severity',trim(payload->>'business_impact'),(payload->>'owner_id')::uuid,
    array(select jsonb_array_elements_text(coalesce(payload->'affected_services','[]'))),
    array(select jsonb_array_elements_text(coalesce(payload->'affected_locations','[]'))))
  on conflict(ticket_id) do update set severity=excluded.severity,business_impact=excluded.business_impact,owner_id=excluded.owner_id,
    affected_services=excluded.affected_services,affected_locations=excluded.affected_locations;
  select revision into result from public.tickets where id=target and organization_id=org;
  return result;
end $$;
revoke all on function public.save_ticket_incident(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_ticket_incident(uuid,uuid,bigint,jsonb) to authenticated;

create function public.submit_incident_ticket(org uuid,token uuid,payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; current_revision bigint;
begin
  if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident access denied' using errcode='42501'; end if;
  -- The receipt fingerprints the full payload, including incident fields.
  result:=public.submit_support_request(org,token,'ticket',payload);
  if not exists(select 1 from public.ticket_incidents where organization_id=org and ticket_id=result) then
    select revision into current_revision from public.tickets where organization_id=org and id=result for update;
    perform public.save_ticket_incident(org,result,current_revision,payload->'incident');
  end if;
  return result;
end $$;
revoke all on function public.submit_incident_ticket(uuid,uuid,jsonb) from public,anon;
grant execute on function public.submit_incident_ticket(uuid,uuid,jsonb) to authenticated;

revoke all on function private.validate_ticket_incident() from public,anon,authenticated;
revoke all on function private.guard_incident_classification() from public,anon,authenticated;
