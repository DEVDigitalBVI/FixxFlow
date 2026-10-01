begin;
-- Trusted registry data; parity-tested against TypeScript.
create or replace function private.automation_definition_catalog() returns jsonb
language sql immutable set search_path='' as $$ select '{"triggers":{"ticket.unassigned_duration_reached":{"entityType":"ticket","configuration":{"durationMinutes":{"value":{"kind":"number","integer":true,"min":1,"max":525600}}}},"ticket.waiting_on_user_duration_reached":{"entityType":"ticket","configuration":{"durationMinutes":{"value":{"kind":"number","integer":true,"min":1,"max":525600}}}},"ticket.open_duration_reached":{"entityType":"ticket","configuration":{"durationMinutes":{"value":{"kind":"number","integer":true,"min":1,"max":525600}}}},"ticket.sla_approaching":{"entityType":"ticket","configuration":{"durationMinutes":{"value":{"kind":"number","integer":true,"min":1,"max":525600}},"objective":{"value":{"kind":"enum","values":["response","resolution"]}}}},"ticket.sla_breached":{"entityType":"ticket","configuration":{"objective":{"value":{"kind":"enum","values":["response","resolution"]}}}},"ticket.created":{"entityType":"ticket","configuration":{}},"ticket.updated":{"entityType":"ticket","configuration":{}},"ticket.assigned":{"entityType":"ticket","configuration":{}},"ticket.status_changed":{"entityType":"ticket","configuration":{}},"ticket.priority_changed":{"entityType":"ticket","configuration":{}},"ticket.resolved":{"entityType":"ticket","configuration":{}}},"fields":{"ticket:priority":{"value":{"kind":"enum","values":["low","normal","high","critical"],"ordered":true},"operators":["equals","not_equals","in","not_in","greater_than","less_than"]},"ticket:status":{"value":{"kind":"enum","values":["new","open","in_progress","waiting_on_user","on_hold","resolved","closed"]},"operators":["equals","not_equals","in","not_in"]},"ticket:title":{"value":{"kind":"string","minLength":3,"maxLength":180},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty","contains","not_contains"]},"ticket:category_id":{"value":{"kind":"reference","resource":"ticket_categories"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:subcategory_id":{"value":{"kind":"reference","resource":"ticket_subcategories"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:assigned_technician_id":{"value":{"kind":"reference","resource":"active_ticket_workers"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:team_id":{"value":{"kind":"reference","resource":"teams"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:requester_id":{"value":{"kind":"reference","resource":"organization_memberships"},"operators":["equals","not_equals","in","not_in"]},"ticket:requester_department_id":{"value":{"kind":"reference","resource":"departments"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:location_id":{"value":{"kind":"reference","resource":"locations"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]}},"actions":{"assign_technician":{"entityType":"ticket","configuration":{"technicianId":{"value":{"kind":"reference","resource":"active_ticket_workers"}}}},"assign_team":{"entityType":"ticket","configuration":{"teamId":{"value":{"kind":"reference","resource":"teams"}}}},"set_priority":{"entityType":"ticket","configuration":{"priority":{"value":{"kind":"enum","values":["low","normal","high","critical"],"ordered":true}}}},"set_status":{"entityType":"ticket","configuration":{"status":{"value":{"kind":"enum","values":["new","open","in_progress","waiting_on_user","on_hold","resolved","closed"]}}}},"set_category":{"entityType":"ticket","configuration":{"categoryId":{"value":{"kind":"reference","resource":"ticket_categories"}}}},"add_internal_note":{"entityType":"ticket","configuration":{"body":{"value":{"kind":"string","minLength":1,"maxLength":20000}}}},"send_notification":{"entityType":"ticket","configuration":{"recipient":{"value":{"kind":"enum","values":["requester","assigned_technician"]}},"template":{"value":{"kind":"enum","values":["ticket_update"]}}}}}}'::jsonb $$;

-- Ordinary events retain revision/type uniqueness (NULLS NOT DISTINCT). A
-- temporal occurrence may share a ticket revision with another threshold.
alter table private.domain_events add column temporal_occurrence_id uuid;
alter table private.domain_events drop constraint domain_events_entity_revision_type_key;
alter table private.domain_events add constraint domain_events_entity_revision_type_key
  unique nulls not distinct(organization_id,entity_type,entity_id,entity_version,event_type,temporal_occurrence_id);
create table private.automation_temporal_occurrences (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  rule_id uuid not null, rule_version bigint not null, entity_id uuid not null,
  trigger_type text not null, episode text not null, threshold_at timestamptz not null,
  event_id uuid not null unique, created_at timestamptz not null default clock_timestamp(),
  unique(organization_id,id), unique(organization_id,rule_id,rule_version,entity_id,episode),
  foreign key(organization_id,rule_id,rule_version) references public.automation_rule_versions(organization_id,rule_id,version),
  foreign key(organization_id,entity_id) references public.tickets(organization_id,id),
  foreign key(organization_id,event_id) references private.domain_events(organization_id,id) deferrable initially deferred
);
alter table private.domain_events add foreign key(organization_id,temporal_occurrence_id) references private.automation_temporal_occurrences(organization_id,id);
create table private.automation_temporal_cursors (
  organization_id uuid not null, rule_id uuid primary key, rule_version bigint not null, generation bigint not null,
  anchor timestamptz, entity_id uuid, scanned_at timestamptz not null default clock_timestamp(),
  foreign key(organization_id,rule_id) references public.automation_rules(organization_id,id),
  check((anchor is null)=(entity_id is null))
);
alter table private.automation_temporal_occurrences enable row level security;
alter table private.automation_temporal_cursors enable row level security;
revoke all on private.automation_temporal_occurrences,private.automation_temporal_cursors from public,anon,authenticated,service_role;

-- Queries use tenant + anchor range + id keyset, with these exact predicates.
create index tickets_temporal_unassigned on public.tickets(organization_id,unassigned_since,id)
  where status not in ('resolved','closed') and assigned_technician_id is null and unassigned_since is not null;
create index tickets_temporal_waiting on public.tickets(organization_id,waiting_on_user_since,id)
  where status='waiting_on_user' and waiting_on_user_since is not null;
create index tickets_temporal_open on public.tickets(organization_id,created_at,id) where status not in ('resolved','closed');
create index tickets_temporal_response on public.tickets(organization_id,response_sla_due_at,id)
  where status not in ('resolved','closed') and first_response_at is null;
create index tickets_temporal_resolution on public.tickets(organization_id,resolution_sla_due_at,id)
  where status not in ('resolved','closed') and resolved_at is null and closed_at is null;
create index automation_temporal_rules on public.automation_rules(trigger_type,id) where enabled and archived_at is null;

-- Configuration validity remains the existing registry validator's responsibility.
-- This adapter calculates a threshold only; it never evaluates rule conditions.
create function private.ticket_temporal_context(ticket public.tickets,definition jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare kind text:=definition#>>'{trigger,type}'; config jsonb:=definition#>'{trigger,configuration}'; anchor timestamptz; episode text; threshold timestamptz;
begin
  if ticket.status in ('resolved','closed') then return null; end if;
  case kind
    when 'ticket.unassigned_duration_reached' then
      if ticket.assigned_technician_id is not null then return null; end if;
      anchor:=ticket.unassigned_since; episode:=ticket.unassigned_episode_id::text;
    when 'ticket.waiting_on_user_duration_reached' then
      if ticket.status<>'waiting_on_user' then return null; end if;
      anchor:=ticket.waiting_on_user_since; episode:=ticket.waiting_on_user_episode_id::text;
    when 'ticket.open_duration_reached' then anchor:=ticket.created_at; episode:='created';
    when 'ticket.sla_approaching','ticket.sla_breached' then
      if config->>'objective'='response' then
        if ticket.first_response_at is not null then return null; end if;
        anchor:=ticket.response_sla_due_at;
      else
        if ticket.resolved_at is not null or ticket.closed_at is not null then return null; end if;
        anchor:=ticket.resolution_sla_due_at;
      end if;
      episode:=(extract(epoch from anchor))::text;
    else return null;
  end case;
  if anchor is null or episode is null then return null; end if;
  threshold:=anchor+make_interval(mins=>case kind when 'ticket.sla_approaching' then -(config->>'durationMinutes')::integer when 'ticket.sla_breached' then 0 else (config->>'durationMinutes')::integer end);
  return jsonb_build_object('anchor',anchor,'episode',episode,'thresholdAt',threshold,'configuration',config);
end $$;

create function private.temporal_event_for_rule(event private.domain_events,rule public.automation_rules) returns boolean
language sql stable set search_path='' as $$
  select case when event.temporal_occurrence_id is null then event.event_type not in
    ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached')
  else exists(select 1 from private.automation_temporal_occurrences o where o.organization_id=event.organization_id and o.id=event.temporal_occurrence_id
    and o.event_id=event.id and o.entity_id=event.entity_id and o.rule_id=rule.id and o.rule_version=rule.version and o.trigger_type=event.event_type
    and o.threshold_at<=event.occurred_at and event.after_snapshot#>'{temporal,configuration}'=rule.definition#>'{trigger,configuration}') end;
$$;
-- Keep the established ordinary event compatibility adapter intact.
alter function private.automation_ticket_event_compatible(private.domain_events) rename to automation_ticket_event_compatible_before_temporal;
create function private.automation_ticket_event_compatible(event private.domain_events) returns boolean
language plpgsql stable set search_path='' as $$
begin
  if event.temporal_occurrence_id is null then return private.automation_ticket_event_compatible_before_temporal(event); end if;
  return event.entity_type='ticket' and event.schema_version=1 and exists(
    select 1 from private.automation_temporal_occurrences o join public.automation_rule_versions v
      on (v.organization_id,v.rule_id,v.version)=(o.organization_id,o.rule_id,o.rule_version)
    where o.organization_id=event.organization_id and o.id=event.temporal_occurrence_id and o.event_id=event.id and o.entity_id=event.entity_id
      and o.trigger_type=event.event_type and o.threshold_at<=event.occurred_at
      and event.after_snapshot#>'{temporal,configuration}'=v.definition#>'{trigger,configuration}');
end $$;
-- SQL-language dispatch must resolve the new adapter, including persisted receipts.
create or replace function private.automation_event_compatible(event private.domain_events) returns boolean
language sql stable set search_path='' as $$ select case event.entity_type when 'ticket' then private.automation_ticket_event_compatible(event) else false end; $$;

create function private.discover_temporal_automation(rule_limit integer,ticket_limit integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare processing private.automation_processing_state; rule public.automation_rules; cursor private.automation_temporal_cursors;
  ticket public.tickets; version public.automation_rule_versions; stamp timestamptz:=clock_timestamp(); deadline timestamptz:=stamp+interval '20 seconds';
  lower_anchor timestamptz; upper_anchor timestamptz; cutoff timestamptz; anchor_column text; predicate text; offset_minutes integer;
  context jsonb; threshold timestamptz; evaluated_stamp timestamptz; occurrence uuid; event_id uuid; correlation_uuid uuid; seen integer; examined integer:=0; emitted integer:=0; duplicates integer:=0; rules integer:=0;
  invocation uuid:=gen_random_uuid();
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  if rule_limit is null or rule_limit not between 1 and 5 or ticket_limit is null or ticket_limit not between 1 and 100 then raise exception 'Invalid discovery bounds' using errcode='22023'; end if;
  select * into processing from private.automation_processing_state for share;
  if not processing.active then return jsonb_build_object('disabled',true,'examined',0,'emitted',0); end if;
  for rule in select r.* from public.automation_rules r left join private.automation_temporal_cursors c on c.rule_id=r.id
    where r.enabled and r.archived_at is null and r.trigger_type in ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached')
    order by c.scanned_at nulls first,r.created_at,r.id limit rule_limit for update of r skip locked loop
    exit when clock_timestamp()>=deadline;
    rules:=rules+1;
    select * into version from public.automation_rule_versions v where (v.organization_id,v.rule_id,v.version)=(rule.organization_id,rule.id,rule.version);
    perform private.validate_automation_definition(version.definition);
    select * into cursor from private.automation_temporal_cursors c where c.rule_id=rule.id;
    if cursor.rule_version is distinct from rule.version or cursor.generation is distinct from processing.generation then cursor.anchor:=null; cursor.entity_id:=null; end if;
    cutoff:=greatest(processing.activated_at,rule.enabled_at,version.created_at);
    offset_minutes:=case rule.trigger_type when 'ticket.sla_approaching' then -(version.definition#>>'{trigger,configuration,durationMinutes}')::integer when 'ticket.sla_breached' then 0 else (version.definition#>>'{trigger,configuration,durationMinutes}')::integer end;
    lower_anchor:=cutoff-make_interval(mins=>offset_minutes); upper_anchor:=stamp-make_interval(mins=>offset_minutes);
    -- Identifiers/predicates are trusted constants, never user SQL expressions.
    case rule.trigger_type
      when 'ticket.unassigned_duration_reached' then anchor_column:='unassigned_since'; predicate:='status not in (''resolved'',''closed'') and assigned_technician_id is null and unassigned_since is not null';
      when 'ticket.waiting_on_user_duration_reached' then anchor_column:='waiting_on_user_since'; predicate:='status=''waiting_on_user'' and waiting_on_user_since is not null';
      when 'ticket.open_duration_reached' then anchor_column:='created_at'; predicate:='status not in (''resolved'',''closed'')';
      else
        if version.definition#>>'{trigger,configuration,objective}'='response' then anchor_column:='response_sla_due_at'; predicate:='status not in (''resolved'',''closed'') and first_response_at is null';
        else anchor_column:='resolution_sla_due_at'; predicate:='status not in (''resolved'',''closed'') and resolved_at is null and closed_at is null'; end if;
    end case;
    seen:=0;
    for ticket in execute format('select * from public.tickets where organization_id=$1 and %s and %I>$2 and %I<=$3 and ($4::timestamptz is null or (%I,id)>($4,$5)) order by %I,id limit $6 for share',predicate,anchor_column,anchor_column,anchor_column,anchor_column)
      using rule.organization_id,lower_anchor,upper_anchor,cursor.anchor,cursor.entity_id,ticket_limit loop
      -- Locking the ticket serializes eligibility/event capture with mutations.
      exit when clock_timestamp()>=deadline;
      seen:=seen+1; examined:=examined+1;
      cursor.anchor:=(to_jsonb(ticket)->>anchor_column)::timestamptz; cursor.entity_id:=ticket.id;
      context:=private.ticket_temporal_context(ticket,version.definition);
      if context is null then continue; end if;
      threshold:=(context->>'thresholdAt')::timestamptz;
      evaluated_stamp:=clock_timestamp();
      if threshold<=cutoff or threshold>stamp or (rule.trigger_type='ticket.sla_approaching' and (context->>'anchor')::timestamptz<=evaluated_stamp) then continue; end if;
      occurrence:=null; event_id:=gen_random_uuid();
      insert into private.automation_temporal_occurrences(organization_id,rule_id,rule_version,entity_id,trigger_type,episode,threshold_at,event_id)
        values(rule.organization_id,rule.id,rule.version,ticket.id,rule.trigger_type,context->>'episode',threshold,event_id)
        on conflict(organization_id,rule_id,rule_version,entity_id,episode) do nothing returning id into occurrence;
      if occurrence is null then
        duplicates:=duplicates+1;
        select o.event_id into event_id from private.automation_temporal_occurrences o
          where (o.organization_id,o.rule_id,o.rule_version,o.entity_id,o.episode)=(rule.organization_id,rule.id,rule.version,ticket.id,context->>'episode');
        raise log '%',jsonb_build_object('component','automation_scheduler','invocationId',invocation,'organizationId',rule.organization_id,'ruleId',rule.id,'ruleVersion',rule.version,'entityId',ticket.id,'eventId',event_id,'triggerType',rule.trigger_type,'thresholdAt',threshold,'result','deduplicated');
        continue;
      end if;
      correlation_uuid:=gen_random_uuid();
      context:=context||jsonb_build_object('ruleId',rule.id,'ruleVersion',rule.version);
      insert into private.domain_events(id,organization_id,event_type,entity_type,entity_id,entity_version,actor_type,actor_id,occurred_at,before_snapshot,after_snapshot,changed_fields,correlation_id,root_event_id,depth,temporal_occurrence_id)
        values(event_id,rule.organization_id,rule.trigger_type,'ticket',ticket.id,ticket.revision,'system',null,evaluated_stamp,null,
          private.ticket_event_snapshot(ticket)||jsonb_build_object('temporal',context),'{}',correlation_uuid,event_id,0,occurrence);
      insert into private.domain_event_deliveries(organization_id,event_id) values(rule.organization_id,event_id);
      emitted:=emitted+1;
      raise log '%',jsonb_build_object('component','automation_scheduler','invocationId',invocation,'organizationId',rule.organization_id,'ruleId',rule.id,'ruleVersion',rule.version,'entityId',ticket.id,'eventId',event_id,'triggerType',rule.trigger_type,'thresholdAt',threshold,'correlationId',correlation_uuid,'result','emitted');
    end loop;
    if seen<ticket_limit and clock_timestamp()<deadline then cursor.anchor:=null; cursor.entity_id:=null; end if;
    insert into private.automation_temporal_cursors(organization_id,rule_id,rule_version,generation,anchor,entity_id,scanned_at)
      values(rule.organization_id,rule.id,rule.version,processing.generation,cursor.anchor,cursor.entity_id,clock_timestamp())
      on conflict(rule_id) do update set rule_version=excluded.rule_version,generation=excluded.generation,anchor=excluded.anchor,entity_id=excluded.entity_id,scanned_at=excluded.scanned_at;
  end loop;
  return jsonb_build_object('invocationId',invocation,'rules',rules,'examined',examined,'emitted',emitted,'duplicates',duplicates);
end $$;
create function public.discover_temporal_automation(rule_limit integer default 5,ticket_limit integer default 100) returns jsonb
language sql security invoker set search_path='' as $$ select private.discover_temporal_automation(rule_limit,ticket_limit); $$;
revoke all on function private.ticket_temporal_context(public.tickets,jsonb),private.temporal_event_for_rule(private.domain_events,public.automation_rules),private.automation_ticket_event_compatible(private.domain_events),private.discover_temporal_automation(integer,integer),public.discover_temporal_automation(integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.discover_temporal_automation(integer,integer),public.discover_temporal_automation(integer,integer) to service_role;

create or replace function private.automation_rule_eligible(event private.domain_events,rule public.automation_rules) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.automation_processing_state p
    join public.automation_rule_versions v on (v.organization_id,v.rule_id,v.version)=(rule.organization_id,rule.id,rule.version)
    join private.automation_version_visibility x on (x.organization_id,x.rule_id,x.version)=(v.organization_id,v.rule_id,v.version)
    where private.temporal_event_for_rule(event,rule) and p.active and rule.enabled and rule.archived_at is null and rule.organization_id=event.organization_id and rule.trigger_type=event.event_type
      and event.occurred_at>greatest(p.activated_at,rule.enabled_at,v.created_at)
      and (x.created_transaction=event.capture_transaction or pg_visible_in_snapshot(x.created_transaction,event.capture_snapshot))
      and (p.activation_transaction=event.capture_transaction or pg_visible_in_snapshot(p.activation_transaction,event.capture_snapshot)));
$$;

-- Repeat scoped temporal admission inside the existing trusted authority.
create or replace function private.begin_automation_execution(delivery_id uuid,token uuid,rule_id uuid,rule_version bigint)
returns public.automation_executions language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; event private.domain_events%rowtype; rule public.automation_rules%rowtype;
  version public.automation_rule_versions%rowtype; processing private.automation_processing_state%rowtype; chain private.automation_chains%rowtype;
  result public.automation_executions%rowtype; conditions jsonb; passed boolean; stamp timestamptz; version_transaction xid8;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  select * into delivery from private.domain_event_deliveries d where d.id=$1 for update;
  if not found or delivery.lease_token is distinct from token or delivery.status<>'leased' or delivery.lease_expires_at<=clock_timestamp() or delivery.consumer<>'automation' then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  select * into event from private.domain_events where id=delivery.event_id and organization_id=delivery.organization_id;
  select * into rule from public.automation_rules r where r.organization_id=event.organization_id and r.id=$3 for share;
  if not found then raise exception 'Automation unavailable' using errcode='42501'; end if;
  select * into result from public.automation_executions e where e.organization_id=event.organization_id and e.event_id=event.id and e.rule_id=$3;
  if found then
    if result.rule_version is distinct from $4 then raise exception 'Pinned version mismatch' using errcode='22023'; end if;
    return result;
  end if;
  select * into processing from private.automation_processing_state for share;
  select * into version from public.automation_rule_versions v where v.organization_id=rule.organization_id and v.rule_id=rule.id and v.version=rule.version;
  select created_transaction into version_transaction from private.automation_version_visibility v where v.organization_id=rule.organization_id and v.rule_id=rule.id and v.version=rule.version;
  -- Strict > excludes equality; event occurrence, never claim time, is used.
  if not private.temporal_event_for_rule(event,rule) or not processing.active or not rule.enabled or rule.archived_at is not null or rule.version is distinct from $4
    or event.occurred_at<=greatest(processing.activated_at,rule.enabled_at,version.created_at)
    or version_transaction is null
    or not (version_transaction=event.capture_transaction or pg_visible_in_snapshot(version_transaction,event.capture_snapshot))
    or not (processing.activation_transaction=event.capture_transaction or pg_visible_in_snapshot(processing.activation_transaction,event.capture_snapshot))
    or rule.trigger_type<>event.event_type or not coalesce(private.automation_event_compatible(event),false) then
    raise exception 'Event is not eligible for this automation' using errcode='55000';
  end if;
  if event.depth>=8 then raise exception 'Automation chain limit reached' using errcode='54000'; end if;
  insert into private.automation_chains(organization_id,correlation_id) values(event.organization_id,event.correlation_id) on conflict do nothing;
  select * into chain from private.automation_chains c where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id for update;
  if chain.execution_count>=32 or exists(select 1 from private.automation_chain_claims c where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id and c.rule_id=rule.id and c.entity_type=event.entity_type and c.entity_id=event.entity_id) then
    raise exception 'Automation chain already claimed or exhausted' using errcode='54000';
  end if;
  if delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  conditions:=private.automation_condition_results(version.definition,event.after_snapshot,event.entity_type);
  passed:=not exists(select 1 from jsonb_array_elements(conditions) c where c->>'status'<>'passed');
  stamp:=clock_timestamp();
  insert into public.automation_executions(organization_id,rule_id,rule_version,rule_name,event_id,delivery_id,trigger_type,entity_type,entity_id,correlation_id,causation_id,root_event_id,depth,processing_generation,expected_entity_revision,status,conditions,started_at,completed_at)
  values(event.organization_id,rule.id,version.version,version.definition->>'name',event.id,delivery.id,event.event_type,event.entity_type,event.entity_id,event.correlation_id,event.causation_id,event.root_event_id,event.depth,processing.generation,event.entity_version,case when passed then 'running' else 'skipped' end,conditions,stamp,case when passed then null else stamp end) returning * into result;
  insert into public.automation_execution_steps(organization_id,execution_id,action_id,action_type,position,status)
  select result.organization_id,result.id,a->>'id',a->>'type',(a->>'position')::integer,case when passed then 'pending' else 'not_attempted' end from jsonb_array_elements(version.definition->'actions') a;
  insert into private.automation_chain_claims values(event.organization_id,event.correlation_id,rule.id,event.entity_type,event.entity_id,result.id);
  update private.automation_chains c set execution_count=execution_count+1 where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id;
  return result;
end $$;

create or replace function private.read_automation_dry_run(target_organization_id uuid,ticket_id uuid,event_id uuid,rule_id uuid,rule_version bigint,draft jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid; ticket public.tickets; event private.domain_events; version public.automation_rule_versions;
  definition jsonb; catalog jsonb:=private.automation_definition_catalog(); item jsonb; spec jsonb; candidate jsonb; property record;
  checks jsonb:='[]'; valid boolean; conditions_valid boolean:=true; assignee uuid; recipient uuid; category uuid; subcategory uuid;
begin
  if auth.uid() is null or not private.has_required_assurance() or not coalesce(private.has_organization_role(target_organization_id,array['administrator']::public.app_role[]),false) then raise exception 'Administrator and assurance required' using errcode='42501'; end if;
  select organization_id into org from public.organization_memberships where organization_id=target_organization_id and user_id=auth.uid() and role='administrator' and status='active';
  if org is null then raise exception 'Access denied' using errcode='42501'; end if;
  select * into ticket from public.tickets t where t.organization_id=org and t.id=ticket_id;
  if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
  if event_id is not null then
    select * into event from private.domain_events e where e.organization_id=org and e.id=event_id and e.entity_type='ticket' and e.entity_id=ticket.id;
    if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
  end if;
  if rule_id is not null then
    if draft is not null or rule_version is null or rule_version<1 then raise exception 'Invalid definition source' using errcode='22023'; end if;
    select * into version from public.automation_rule_versions v where v.organization_id=org and v.rule_id=read_automation_dry_run.rule_id and v.version=rule_version;
    if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
    definition:=private.validate_automation_definition(version.definition);
  else
    if rule_version is not null or draft is null then raise exception 'Invalid definition source' using errcode='22023'; end if;
    definition:=private.validate_automation_definition(draft);
  end if;
  -- Validate reference existence separately from structural validity, without
  -- taking the mutation adapter's FOR SHARE locks or exposing foreign names.
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    spec:=catalog#>array['fields','ticket:'||(item->>'field'),'value'];
    if spec->>'kind'='reference' and item?'value' then
      for candidate in select * from jsonb_array_elements(case when jsonb_typeof(item->'value')='array' then item->'value' else jsonb_build_array(item->'value') end) loop
        conditions_valid:=private.automation_reference_read(org,spec->>'resource',(candidate#>>'{}')::uuid,false) and conditions_valid;
      end loop;
    end if;
    if item->>'operator'='equals' and item->>'field'='category_id' then category:=(item->>'value')::uuid; end if;
    if item->>'operator'='equals' and item->>'field'='subcategory_id' then subcategory:=(item->>'value')::uuid; end if;
  end loop;
  if category is not null and subcategory is not null then
    conditions_valid:=conditions_valid and exists(select 1 from public.ticket_subcategories s where s.organization_id=org and s.id=subcategory and s.category_id=category);
  end if;
  assignee:=ticket.assigned_technician_id;
  for item in select * from jsonb_array_elements(definition->'actions') loop
    valid:=true;
    for property in select * from jsonb_each(catalog#>array['actions',item->>'type','configuration']) loop
      spec:=property.value->'value';
      if spec->>'kind'='reference' then valid:=private.automation_reference_read(org,spec->>'resource',(item#>>array['configuration',property.key])::uuid,true) and valid; end if;
    end loop;
    -- Resolve an explicit notification's recipient after preceding proposed
    -- assignments, without applying those assignments to any record.
    if item->>'type'='assign_technician' then assignee:=(item#>>'{configuration,technicianId}')::uuid; end if;
    if item->>'type'='send_notification' then
      recipient:=case item#>>'{configuration,recipient}' when 'requester' then ticket.requester_id else assignee end;
      valid:=exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=recipient and m.status='active' and
        (m.role in ('technician','administrator') or (item#>>'{configuration,recipient}'='requester' and m.user_id=ticket.requester_id)));
    end if;
    checks:=checks||jsonb_build_array(jsonb_build_object('actionId',item->>'id','valid',valid));
  end loop;
  return jsonb_build_object('evaluatedAt',statement_timestamp(),'organizationId',org,'ticketId',ticket.id,'ticketNumber',ticket.ticket_number,'revision',ticket.revision,
    'snapshot',private.ticket_event_snapshot(ticket),'event',case when event.id is null then null else private.domain_event_envelope(event) end,
    'definition',definition,'ruleId',rule_id,'ruleVersion',rule_version,'storedEnabled',version.enabled,'storedArchived',version.archived_at is not null,
    'conditionsReferencesValid',conditions_valid,'actionReferences',checks);
end $$;

commit;
