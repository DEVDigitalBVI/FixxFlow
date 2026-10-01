-- Stage 3: durable transport only. No automation execution or ticket commands.
create table private.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  schema_version integer not null default 1 check(schema_version>0),
  event_type text not null check(event_type ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$'),
  entity_type text not null check(entity_type ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$'),
  entity_id uuid not null,
  entity_version bigint not null check(entity_version between 1 and 9007199254740991),
  actor_type text not null check(actor_type in ('member','system','automation')),
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  before_snapshot jsonb check(jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null check(jsonb_typeof(after_snapshot)='object'),
  changed_fields text[] not null,
  correlation_id uuid not null,
  causation_id uuid,
  root_event_id uuid not null,
  depth integer not null check(depth>=0),
  automation_execution_id uuid,
  unique(organization_id,id),
  constraint domain_events_entity_revision_type_key unique(organization_id,entity_type,entity_id,entity_version,event_type),
  foreign key(organization_id,causation_id) references private.domain_events(organization_id,id),
  foreign key(organization_id,root_event_id) references private.domain_events(organization_id,id),
  check((actor_type='member' and actor_id is not null) or (actor_type<>'member' and actor_id is null)),
  check((actor_type='automation')=(automation_execution_id is not null)),
  check((depth=0 and causation_id is null and root_event_id=id) or
    (depth>0 and causation_id is not null and causation_id<>id and root_event_id<>id))
);
create index domain_events_correlation on private.domain_events(organization_id,correlation_id,occurred_at,id);
create index domain_events_cause on private.domain_events(organization_id,causation_id) where causation_id is not null;
create index domain_events_root on private.domain_events(organization_id,root_event_id);

create table private.domain_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  consumer text not null default 'automation' check(consumer ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$'),
  status text not null default 'pending' check(status in ('pending','leased','acknowledged','dead')),
  attempts integer not null default 0 check(attempts between 0 and 8),
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid, leased_at timestamptz, lease_expires_at timestamptz,
  completed_at timestamptz,
  error_code text check(error_code in ('transient_failure','invalid_event','unsupported_event','permanent_failure','retry_exhausted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(organization_id,event_id,consumer),
  foreign key(organization_id,event_id) references private.domain_events(organization_id,id),
  check((status='leased' and lease_token is not null and leased_at is not null and lease_expires_at>leased_at and available_at=lease_expires_at)
    or (status<>'leased' and leased_at is null and lease_expires_at is null)),
  check((status in ('acknowledged','dead'))=(completed_at is not null))
);
create index domain_deliveries_ready on private.domain_event_deliveries(consumer,available_at,id) where status in ('pending','leased');
alter table private.domain_events enable row level security;
alter table private.domain_event_deliveries enable row level security;
-- No direct-access policies, including for administrators. Service also uses RPCs.
revoke all on private.domain_events,private.domain_event_deliveries from public,anon,authenticated,service_role;

create function private.protect_domain_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Domain events are immutable' using errcode='42501'; end $$;
create trigger domain_events_immutable before update or delete on private.domain_events for each row execute function private.protect_domain_event();

create function private.domain_event_envelope(event private.domain_events) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',event.id,'schemaVersion',event.schema_version,'type',event.event_type,
    'organizationId',event.organization_id,'entityType',event.entity_type,'entityId',event.entity_id,'entityVersion',event.entity_version,
    'actorType',event.actor_type,'actorId',event.actor_id,'timestamp',event.occurred_at,
    'before',event.before_snapshot,'after',event.after_snapshot,'changedFields',event.changed_fields,
    'correlationId',event.correlation_id,'causationId',event.causation_id,'rootEventId',event.root_event_id,'depth',event.depth)
    || case when event.automation_execution_id is null then '{}'::jsonb else jsonb_build_object('automationExecutionId',event.automation_execution_id) end;
$$;

-- Only trusted database publishers call this; no client/service EXECUTE grant.
-- Parents supply correlation/root/depth from persisted, same-tenant records.
create function private.publish_domain_event(org uuid,event_type text,entity_type text,entity_id uuid,entity_version bigint,
  before_snapshot jsonb,after_snapshot jsonb,changed_fields text[],correlation uuid,parent_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid:=gen_random_uuid(); parent private.domain_events%rowtype; existing private.domain_events%rowtype; actor uuid:=auth.uid(); inserted_id uuid;
begin
  if parent_id is not null then
    select * into parent from private.domain_events where organization_id=org and id=parent_id;
    if not found then raise exception 'Event cause unavailable' using errcode='42501'; end if;
  end if;
  -- Never label a service operation as a member using a supplied service JWT sub.
  if current_setting('role',true)='service_role' or actor is null then actor:=null;
  elsif not private.is_active_organization_member(org) or not private.has_required_assurance() then
    raise exception 'Event actor unavailable' using errcode='42501';
  end if;
  insert into private.domain_events(id,organization_id,event_type,entity_type,entity_id,entity_version,actor_type,actor_id,
    before_snapshot,after_snapshot,changed_fields,correlation_id,causation_id,root_event_id,depth)
  values(result,org,event_type,entity_type,entity_id,entity_version,case when actor is null then 'system' else 'member' end,actor,
    before_snapshot,after_snapshot,changed_fields,coalesce(parent.correlation_id,correlation),parent_id,coalesce(parent.root_event_id,result),coalesce(parent.depth+1,0))
  on conflict on constraint domain_events_entity_revision_type_key do nothing returning id into inserted_id;
  if inserted_id is null then
    select e.* into existing from private.domain_events e where e.organization_id=org and e.entity_type=publish_domain_event.entity_type
      and e.entity_id=publish_domain_event.entity_id and e.entity_version=publish_domain_event.entity_version and e.event_type=publish_domain_event.event_type;
    if existing.before_snapshot is distinct from before_snapshot or existing.after_snapshot is distinct from after_snapshot
      or existing.changed_fields is distinct from changed_fields or existing.actor_id is distinct from actor or existing.causation_id is distinct from parent_id then
      raise exception 'Conflicting event revision' using errcode='23505';
    end if;
    return existing.id;
  end if;
  insert into private.domain_event_deliveries(organization_id,event_id) values(org,result);
  return result;
end $$;

-- A future trusted mutation RPC can SET LOCAL these two values in its own
-- transaction. Client GUCs/headers never confer provenance: only service role
-- plus a live persisted lease in the target tenant can provide a parent.
create function private.domain_event_cause(org uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare delivery text:=nullif(current_setting('app.domain_event_delivery',true),''); token text:=nullif(current_setting('app.domain_event_lease',true),''); context private.domain_event_deliveries%rowtype;
begin
  if current_setting('role',true)<>'service_role' or (delivery is null and token is null) then return null; end if;
  select * into context from private.domain_event_deliveries
  where id=delivery::uuid and organization_id=org and lease_token=token::uuid for share;
  if not found or context.status<>'leased' or context.lease_expires_at<=clock_timestamp() then raise exception 'Event lease unavailable' using errcode='42501'; end if;
  return context.event_id;
end $$;

alter table public.tickets add column revision bigint not null default 1 check(revision between 1 and 9007199254740991);
-- Existing INSERT/UPDATE grants are column allowlists and do not include revision.
revoke insert(revision),update(revision) on public.tickets from anon,authenticated;
create function private.prepare_ticket_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.revision:=1;
  elsif row(new.title,new.description,new.requester_id,new.assigned_technician_id,new.team_id,new.category_id,new.subcategory_id,new.priority,new.status,new.location_id,new.due_at,new.first_response_at,new.resolved_at,new.closed_at,new.response_sla_due_at,new.resolution_sla_due_at,new.routing_mode)
    is distinct from row(old.title,old.description,old.requester_id,old.assigned_technician_id,old.team_id,old.category_id,old.subcategory_id,old.priority,old.status,old.location_id,old.due_at,old.first_response_at,old.resolved_at,old.closed_at,old.response_sla_due_at,old.resolution_sla_due_at,old.routing_mode)
  then new.revision:=old.revision+1;
  else new.revision:=old.revision; end if;
  return new;
end $$;
-- Alphabetically after employee restrictions, routing, timestamp and SLA prep.
create trigger tickets_z_domain_revision before insert or update on public.tickets for each row execute function private.prepare_ticket_revision();

create function private.ticket_event_snapshot(ticket public.tickets) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',ticket.title,'priority',ticket.priority,'status',ticket.status,
    'category_id',ticket.category_id,'subcategory_id',ticket.subcategory_id,'assigned_technician_id',ticket.assigned_technician_id,
    'team_id',ticket.team_id,'requester_id',ticket.requester_id,'location_id',ticket.location_id,
    'requester_department_id',(select department_id from public.profiles where organization_id=ticket.organization_id and user_id=ticket.requester_id),
    'due_at',ticket.due_at,'first_response_at',ticket.first_response_at);
$$;
create function private.capture_ticket_domain_events() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; current_snapshot jsonb:=private.ticket_event_snapshot(new); changes text[]:='{}'; field text;
  correlation uuid:=gen_random_uuid(); parent uuid; events text[]:='{}'; event_type text;
begin
  if tg_op='UPDATE' and new.revision=old.revision then return new; end if;
  parent:=private.domain_event_cause(new.organization_id);
  if tg_op='INSERT' then
    select array_agg(key order by key) into changes from jsonb_object_keys(current_snapshot) key;
    events:=array['ticket.created'];
  else
    previous:=private.ticket_event_snapshot(old);
    for field in select key from jsonb_object_keys(current_snapshot) key order by key loop
      if previous->field is distinct from current_snapshot->field then changes:=array_append(changes,field); end if;
    end loop;
    -- Sensitive content is represented only by its change marker.
    if new.description is distinct from old.description then changes:=array_append(changes,'description'); end if;
    if new.status is distinct from old.status then events:=array_append(events,'ticket.status_changed'); end if;
    if new.priority is distinct from old.priority then events:=array_append(events,'ticket.priority_changed'); end if;
    if (new.assigned_technician_id is distinct from old.assigned_technician_id and new.assigned_technician_id is not null)
      or (new.team_id is distinct from old.team_id and new.team_id is not null) then events:=array_append(events,'ticket.assigned'); end if;
    if old.status not in ('resolved','closed') and new.status in ('resolved','closed') then events:=array_append(events,'ticket.resolved'); end if;
    if changes && array['title','description','requester_id','category_id','subcategory_id','location_id','due_at','first_response_at']
      or (old.assigned_technician_id is not null and new.assigned_technician_id is null)
      or (old.team_id is not null and new.team_id is null) then events:=array_append(events,'ticket.updated'); end if;
  end if;
  foreach event_type in array events loop
    perform private.publish_domain_event(new.organization_id,event_type,'ticket',new.id,new.revision,previous,current_snapshot,changes,correlation,parent);
  end loop;
  return new;
end $$;
create trigger tickets_domain_events after insert or update on public.tickets for each row execute function private.capture_ticket_domain_events();

create function private.claim_domain_events(batch_size integer,lease_seconds integer,consumer_name text)
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; stamp timestamptz:=clock_timestamp(); token uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if batch_size is null or batch_size not between 1 and 100 or lease_seconds is null or lease_seconds not between 30 and 900 or consumer_name is distinct from 'automation' then
    raise exception 'Invalid claim parameters' using errcode='22023'; end if;
  for delivery in select d.* from private.domain_event_deliveries d where d.consumer=consumer_name and d.status in ('pending','leased') and d.available_at<=stamp
    order by d.available_at,d.id limit batch_size for update skip locked loop
    if delivery.attempts>=8 then
      update private.domain_event_deliveries set status='dead',error_code='retry_exhausted',completed_at=stamp,updated_at=stamp,leased_at=null,lease_expires_at=null,lease_token=null where id=delivery.id;
      continue;
    end if;
    token:=gen_random_uuid();
    update private.domain_event_deliveries set status='leased',attempts=domain_event_deliveries.attempts+1,lease_token=token,leased_at=stamp,
      lease_expires_at=stamp+make_interval(secs=>lease_seconds),available_at=stamp+make_interval(secs=>lease_seconds),updated_at=stamp
    where id=delivery.id;
    return query select delivery.id,token,stamp+make_interval(secs=>lease_seconds),delivery.attempts+1,private.domain_event_envelope(e)
      from private.domain_events e where e.organization_id=delivery.organization_id and e.id=delivery.event_id;
  end loop;
end $$;
create function private.finish_domain_event_delivery(delivery_id uuid,token uuid,outcome text,failure_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; stamp timestamptz:=clock_timestamp(); next_status text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if outcome is null or outcome not in ('acknowledged','retry','failed')
    or (outcome='acknowledged' and failure_code is not null)
    or (outcome<>'acknowledged' and (failure_code is null or failure_code not in ('transient_failure','invalid_event','unsupported_event','permanent_failure'))) then
    raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  select * into delivery from private.domain_event_deliveries where id=delivery_id for update;
  stamp:=clock_timestamp(); -- Recheck expiry after any lock wait, not before it.
  if not found or token is null or delivery.lease_token is distinct from token then return false; end if;
  next_status:=case when outcome='acknowledged' then 'acknowledged' when outcome='failed' or delivery.attempts>=8 then 'dead' else 'pending' end;
  if delivery.status<>'leased' then return delivery.status=next_status and delivery.error_code is not distinct from failure_code; end if;
  if delivery.lease_expires_at<=stamp then return false; end if;
  update private.domain_event_deliveries set status=next_status,error_code=failure_code,
    available_at=case when next_status='pending' then stamp+make_interval(secs=>least(3600,30*power(2,delivery.attempts-1))::integer) else available_at end,
    completed_at=case when next_status in ('acknowledged','dead') then stamp else null end,
    leased_at=null,lease_expires_at=null,updated_at=stamp where id=delivery.id;
  return true;
end $$;
create function public.claim_domain_events(batch_size integer default 20,lease_seconds integer default 120,consumer_name text default 'automation')
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language sql security invoker set search_path='' as $$ select * from private.claim_domain_events(batch_size,lease_seconds,consumer_name); $$;
create function public.finish_domain_event_delivery(delivery_id uuid,token uuid,outcome text,failure_code text default null)
returns boolean language sql security invoker set search_path='' as $$ select private.finish_domain_event_delivery(delivery_id,token,outcome,failure_code); $$;

revoke all on function private.protect_domain_event(),private.domain_event_envelope(private.domain_events),
  private.publish_domain_event(uuid,text,text,uuid,bigint,jsonb,jsonb,text[],uuid,uuid),private.domain_event_cause(uuid),
  private.prepare_ticket_revision(),private.ticket_event_snapshot(public.tickets),private.capture_ticket_domain_events(),
  private.claim_domain_events(integer,integer,text),private.finish_domain_event_delivery(uuid,uuid,text,text),
  public.claim_domain_events(integer,integer,text),public.finish_domain_event_delivery(uuid,uuid,text,text)
from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.claim_domain_events(integer,integer,text),private.finish_domain_event_delivery(uuid,uuid,text,text),
  public.claim_domain_events(integer,integer,text),public.finish_domain_event_delivery(uuid,uuid,text,text) to service_role;
