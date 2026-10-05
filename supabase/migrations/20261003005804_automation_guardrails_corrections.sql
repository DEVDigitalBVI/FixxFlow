begin;
-- Stage 12 corrections. Never activates processing or rewrites saved definitions.
-- Saved definitions retain Stage 1–11 structural bounds. The new byte ceiling is
-- a write/admission policy, not a retroactive constraint on immutable history.
create or replace function private.validate_automation_stored_definition(definition jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare catalog jsonb:=private.automation_definition_catalog(); trigger_spec jsonb; field_spec jsonb; action_spec jsonb;
  item jsonb; candidate jsonb; op text; ids text[]; positions integer[]:='{}'; position integer; canonical_actions jsonb;
begin
  if not private.automation_bounded_json(definition) or not private.automation_object(definition,array['schemaVersion','name','description','trigger','conditions','actions']) then raise exception 'Invalid automation definition' using errcode='22023'; end if;
  if definition->'schemaVersion' is distinct from '1'::jsonb
    or not private.automation_value_valid(definition->'name','{"kind":"string","minLength":1,"maxLength":120}')
    or not (definition?'description') or (definition->'description'<>'null'::jsonb and not private.automation_value_valid(definition->'description','{"kind":"string","maxLength":2000}')) then raise exception 'Invalid automation metadata' using errcode='22023'; end if;
  trigger_spec:=catalog->'triggers'->(definition#>>'{trigger,type}');
  if trigger_spec is null or not private.automation_object(definition->'trigger',array['type','configuration'])
    or not private.automation_configuration_valid(definition#>'{trigger,configuration}',trigger_spec->'configuration') then raise exception 'Invalid automation trigger' using errcode='22023'; end if;
  item:=definition->'conditions';
  if not private.automation_object(item,array['kind','id','operator','children']) or item->>'kind' is distinct from 'group' or item->>'operator' is distinct from 'and'
    or not private.automation_identifier(item->'id') or jsonb_typeof(item->'children') is distinct from 'array' then raise exception 'Invalid AND group' using errcode='22023'; end if;
  if jsonb_array_length(item->'children')>50 then raise exception 'Too many conditions' using errcode='22023'; end if;
  ids:=array[item->>'id'];
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    if not private.automation_object(item,array['kind','id','field','operator','value']) or item->>'kind' is distinct from 'condition'
      or not private.automation_identifier(item->'id') or (item->>'id')=any(ids) then raise exception 'Invalid condition' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
    field_spec:=catalog->'fields'->((trigger_spec->>'entityType')||':'||(item->>'field'));
    op:=item->>'operator';
    if field_spec is null or not coalesce((field_spec->'operators') @> jsonb_build_array(op),false) then raise exception 'Invalid condition field or operator' using errcode='22023'; end if;
    if op in ('is_empty','is_not_empty') then
      if item?'value' then raise exception 'Unexpected condition value' using errcode='22023'; end if;
    elsif op in ('in','not_in') then
      if jsonb_typeof(item->'value') is distinct from 'array' then raise exception 'Invalid condition list' using errcode='22023'; end if;
      if jsonb_array_length(item->'value') not between 1 and 100 then raise exception 'Invalid condition list' using errcode='22023'; end if;
      for candidate in select * from jsonb_array_elements(item->'value') loop
        if not coalesce(private.automation_value_valid(candidate,field_spec->'value'),false) then raise exception 'Invalid condition value' using errcode='22023'; end if;
      end loop;
    else
      if op in ('contains','not_contains') then
        if field_spec#>>'{value,kind}'='string_set' then
          field_spec:=jsonb_set(field_spec,'{value}',jsonb_build_object('kind','string','minLength',1,'maxLength',field_spec#>'{value,itemMaxLength}'));
        else field_spec:=jsonb_set(field_spec,'{value,minLength}','1'); end if;
      end if;
      if not coalesce(private.automation_value_valid(item->'value',field_spec->'value'),false) then raise exception 'Invalid condition value' using errcode='22023'; end if;
    end if;
  end loop;
  if jsonb_typeof(definition->'actions') is distinct from 'array' then raise exception 'Invalid actions' using errcode='22023'; end if;
  if jsonb_array_length(definition->'actions') not between 1 and 20 then raise exception 'Invalid action count' using errcode='22023'; end if;
  ids:='{}';
  for item in select * from jsonb_array_elements(definition->'actions') loop
    if not private.automation_object(item,array['id','type','position','configuration']) or not private.automation_identifier(item->'id') or (item->>'id')=any(ids)
      or not coalesce(private.automation_value_valid(item->'position',jsonb_build_object('kind','number','integer',true,'min',0,'max',jsonb_array_length(definition->'actions')-1)),false) then raise exception 'Invalid action order or identifier' using errcode='22023'; end if;
    position:=(item->>'position')::numeric::integer;
    if position=any(positions) then raise exception 'Duplicate action position' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id'); positions:=array_append(positions,position);
    action_spec:=catalog->'actions'->(item->>'type');
    if action_spec is null or action_spec->>'entityType' is distinct from trigger_spec->>'entityType'
      or (action_spec?'triggerTypes' and not (action_spec->'triggerTypes') @> jsonb_build_array(definition#>>'{trigger,type}'))
      or not private.automation_configuration_valid(item->'configuration',action_spec->'configuration') then raise exception 'Invalid automation action' using errcode='22023'; end if;
  end loop;
  select jsonb_agg(value order by (value->>'position')::numeric) into canonical_actions from jsonb_array_elements(definition->'actions');
  return jsonb_set(definition,'{actions}',canonical_actions);
end $$;

create or replace function private.validate_automation_definition(definition jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare validated jsonb;
begin
 validated:=private.validate_automation_stored_definition(definition);
 if private.automation_definition_bytes(validated)>coalesce((private.automation_safety_limits()->>'definitionBytes')::integer,262144) then
  raise exception 'Definition safety limit exceeded' using errcode='FF004';
 end if;
 return validated;
end $$;

alter table public.automation_rules drop constraint automation_rules_definition_check;
alter table public.automation_rules add constraint automation_rules_definition_check
 check(definition=private.validate_automation_stored_definition(definition)) not valid;
alter table public.automation_rules validate constraint automation_rules_definition_check;

-- RPC validation remains authoritative; this also protects direct privileged
-- writes. Disable/archive of an unchanged legacy definition must remain possible.
-- pg_dump recreates triggers after data, preserving valid legacy restores.
create function private.enforce_automation_definition_limit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.definition is distinct from old.definition or (new.enabled and not old.enabled) then
  perform private.validate_automation_definition(new.definition);
 end if;
 return new;
end $$;
create trigger automation_definition_limit before insert or update on public.automation_rules
 for each row execute function private.enforce_automation_definition_limit();
revoke all on function private.validate_automation_stored_definition(jsonb),private.enforce_automation_definition_limit() from public,anon,authenticated,service_role;

create or replace function private.discover_temporal_automation(rule_limit integer,ticket_limit integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare processing private.automation_processing_state; rule public.automation_rules; cursor private.automation_temporal_cursors;
  ticket public.tickets; version public.automation_rule_versions; stamp timestamptz:=clock_timestamp(); deadline timestamptz:=stamp+interval '20 seconds';
  lower_anchor timestamptz; upper_anchor timestamptz; cutoff timestamptz; anchor_column text; predicate text; offset_minutes integer;
  context jsonb; threshold timestamptz; evaluated_stamp timestamptz; occurrence uuid; event_id uuid; correlation_uuid uuid; seen integer; examined integer:=0; emitted integer:=0; duplicates integer:=0; rules integer:=0;
  invocation uuid:=gen_random_uuid(); tenant private.automation_tenant_schedule; slot integer; scanned_rules uuid[]:='{}';
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  if rule_limit is null or rule_limit not between 1 and 5 or ticket_limit is null or ticket_limit not between 1 and 100 then raise exception 'Invalid discovery bounds' using errcode='22023'; end if;
  select * into processing from private.automation_processing_state for share;
  if not processing.active then return jsonb_build_object('disabled',true,'examined',0,'emitted',0); end if;
  for slot in 1..rule_limit loop
    exit when clock_timestamp()>=deadline;
    select s.* into tenant from private.automation_tenant_schedule s where exists(
      select 1 from public.automation_rules r where r.organization_id=s.organization_id and not (r.id=any(scanned_rules)) and r.enabled and r.archived_at is null and r.trigger_type in ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached'))
      order by s.last_discovered_at,s.organization_id limit 1 for update of s skip locked;
    if not found then exit; end if;
    select r.* into rule from public.automation_rules r left join private.automation_temporal_cursors c on c.rule_id=r.id
    where r.organization_id=tenant.organization_id and not (r.id=any(scanned_rules)) and r.enabled and r.archived_at is null and r.trigger_type in ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached')
    order by c.scanned_at nulls first,r.created_at,r.id limit 1 for update of r skip locked;
    if not found then
      update private.automation_tenant_schedule set last_discovered_at=clock_timestamp() where organization_id=tenant.organization_id;
      continue;
    end if;
    exit when clock_timestamp()>=deadline;
    update private.automation_tenant_schedule set last_discovered_at=clock_timestamp() where organization_id=tenant.organization_id;
    scanned_rules:=array_append(scanned_rules,rule.id);
    rules:=rules+1;
    select * into version from public.automation_rule_versions v where (v.organization_id,v.rule_id,v.version)=(rule.organization_id,rule.id,rule.version);
    perform private.validate_automation_stored_definition(version.definition);
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
      if threshold<=cutoff or threshold>stamp then continue; end if;
      if rule.trigger_type='ticket.sla_approaching' and (context->>'anchor')::timestamptz<=evaluated_stamp then
        -- Observation only. The original skip remains; no event or execution.
        insert into private.automation_missed_windows(organization_id,rule_id,rule_version,entity_id,episode,threshold_at,deadline_at,observed_at)
          select rule.organization_id,rule.id,rule.version,ticket.id,context->>'episode',threshold,(context->>'anchor')::timestamptz,evaluated_stamp
          where not exists(select 1 from private.automation_temporal_occurrences o where (o.organization_id,o.rule_id,o.rule_version,o.entity_id,o.episode)=(rule.organization_id,rule.id,rule.version,ticket.id,context->>'episode'))
          on conflict(organization_id,rule_id,rule_version,entity_id,episode) do nothing;
        continue;
      end if;
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

create or replace function private.read_automation_operations_history(org uuid,query text,trigger_type text,result_filter text,since_at timestamptz,until_at timestamptz,before_at timestamptz,before_id uuid,ticket_number bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare stamp timestamptz:=statement_timestamp(); start_at timestamptz:=coalesce(since_at,stamp-interval '24 hours'); end_at timestamptz:=coalesce(until_at,stamp); result jsonb;
begin
 perform private.require_automation_operations_admin(org);
 if query is null or char_length(query)>120 or trigger_type is null or char_length(trigger_type)>100 or result_filter is null or result_filter not in ('all','succeeded','skipped','running','action_failed','retry_exhausted','delivery_failed','guardrail','failures')
  or start_at>=end_at or end_at-start_at>interval '31 days' or (before_at is null)<>(before_id is null) or ticket_number<1 then raise exception 'Invalid history filters' using errcode='22023'; end if;
 with candidates as materialized(
  select x.id,x.rule_id,x.rule_version,x.rule_name,x.trigger_type,x.entity_id,x.started_at,x.status,x.error_code,x.duration_ms,t.ticket_number
  from public.automation_executions x left join public.tickets t on t.organization_id=x.organization_id and t.id=x.entity_id
  where x.organization_id=org and x.started_at>=start_at and x.started_at<end_at
    and (query='' or strpos(lower(x.rule_name),lower(query))>0) and (read_automation_operations_history.trigger_type='' or x.trigger_type=read_automation_operations_history.trigger_type)
    and (read_automation_operations_history.ticket_number is null or t.ticket_number=read_automation_operations_history.ticket_number)
    and (before_at is null or (x.started_at,x.id)<(before_at,before_id))
    and case result_filter when 'all' then true when 'failures' then x.status in ('failed','partially_completed')
      when 'guardrail' then x.error_code in ('chain_limit','notification_fanout_limit')
      when 'action_failed' then x.status in ('failed','partially_completed') and x.error_code is distinct from 'retry_exhausted' and x.error_code is distinct from 'delivery_failed' and x.error_code is distinct from 'chain_limit' and x.error_code is distinct from 'notification_fanout_limit'
      when 'retry_exhausted' then x.error_code='retry_exhausted' when 'delivery_failed' then x.error_code='delivery_failed' else x.status=result_filter end
  order by x.started_at desc,x.id desc limit 51),
 page as(select * from candidates order by started_at desc,id desc limit 50),
 rows as(select p.*, (select count(*) from public.automation_execution_steps s where s.organization_id=org and s.execution_id=p.id and s.status='succeeded') completed_actions,
  (select count(*) from public.automation_execution_steps s where s.organization_id=org and s.execution_id=p.id) total_actions from page p)
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(rows) order by started_at desc,id desc),'[]'),'hasNext',(select count(*)>50 from candidates),'since',start_at,'until',end_at) into result from rows;
 return result;
end $$;

-- Count successful leases separately from inspection. Keep the old maximum
-- batch_size * 100 eligibility checks, with at most 20 tenant visits and 100
-- candidate rows per visit. An exhausted tenant is visited once per invocation.
create or replace function private.claim_automation_events(batch_size integer,lease_seconds integer)
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries; source private.domain_events;
 tenant private.automation_tenant_schedule; stamp timestamptz; token uuid;
 claimed integer:=0; inspected integer:=0; visits integer:=0;
 exhausted uuid[]:='{}'; selected boolean; scan_at timestamptz; scan_id uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if batch_size is null or batch_size not between 1 and 20 or lease_seconds is null or lease_seconds not between 30 and 900 then raise exception 'Invalid claim parameters' using errcode='22023'; end if;
 if not (select active from private.automation_processing_state) then return; end if;
 while claimed<batch_size and inspected<batch_size*100 and visits<20 loop
  stamp:=clock_timestamp();
  select s.* into tenant from private.automation_tenant_schedule s
   where not (s.organization_id=any(exhausted)) and exists(
    select 1 from private.domain_event_deliveries d where d.organization_id=s.organization_id
     and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp)
   order by s.last_claimed_at,s.organization_id limit 1 for update of s skip locked;
  if not found then exit; end if;
  visits:=visits+1;
  update private.automation_tenant_schedule set last_claimed_at=clock_timestamp() where organization_id=tenant.organization_id;
  selected:=false; scan_at:=null; scan_id:=null;
  -- Materialize only the cheap indexed candidate page. Evaluate eligibility
  -- lazily, stopping after one actionable candidate instead of spending an
  -- entire delivery slot on an empty page. Preference stays within that page.
  for delivery in
   with candidates as materialized(
    select d.id from private.domain_event_deliveries d where d.organization_id=tenant.organization_id
     and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp
     and (tenant.queue_scan_at is null or (d.available_at,d.id)>(tenant.queue_scan_at,tenant.queue_scan_id))
    order by d.available_at,d.id limit least(100,batch_size*100-inspected))
   select d.* from candidates join private.domain_event_deliveries d using(id)
    where d.organization_id=tenant.organization_id and d.consumer='automation'
     and d.status in ('pending','leased') and d.available_at<=stamp
    order by ((d.attempts>0)=tenant.last_was_retry),d.available_at,d.id for update of d skip locked
  loop
   inspected:=inspected+1;
   if scan_at is null or (delivery.available_at,delivery.id)>(scan_at,scan_id) then scan_at:=delivery.available_at; scan_id:=delivery.id; end if;
   select * into source from private.domain_events e where (e.organization_id,e.id)=(delivery.organization_id,delivery.event_id);
   if delivery.attempts>=8 or exists(select 1 from public.automation_executions x where x.organization_id=delivery.organization_id and x.delivery_id=delivery.id)
     or exists(select 1 from public.automation_rules r where r.organization_id=source.organization_id and r.trigger_type=source.event_type and private.automation_rule_eligible(source,r)) then
    selected:=true; exit;
   end if;
  end loop;
  if not selected then
   update private.automation_tenant_schedule set queue_scan_at=scan_at,queue_scan_id=scan_id where organization_id=tenant.organization_id;
   exhausted:=array_append(exhausted,tenant.organization_id);
   continue;
  end if;
  if delivery.attempts>=8 then
   update private.domain_event_deliveries set status='dead',error_code='retry_exhausted',completed_at=clock_timestamp(),updated_at=clock_timestamp(),leased_at=null,lease_expires_at=null,lease_token=null where id=delivery.id;
   continue;
  end if;
  update private.automation_tenant_schedule set last_was_retry=(delivery.attempts>0) where organization_id=tenant.organization_id;
  if delivery.attempts>0 and not private.take_automation_capacity(delivery.organization_id,'retryClaims') then
   update private.domain_event_deliveries set status='pending',capacity_reason='worker_deferred_capacity',capacity_deferred_at=coalesce(capacity_deferred_at,clock_timestamp()),available_at=clock_timestamp()+interval '60 seconds',leased_at=null,lease_expires_at=null,lease_token=null,updated_at=clock_timestamp() where id=delivery.id;
   continue; -- Next turn prefers fresh work; a retry reservation is not a lease.
  end if;
  if not private.take_automation_capacity(delivery.organization_id,'claims') then
   update private.domain_event_deliveries set status='pending',capacity_reason='worker_deferred_capacity',capacity_deferred_at=coalesce(capacity_deferred_at,clock_timestamp()),available_at=clock_timestamp()+interval '60 seconds',leased_at=null,lease_expires_at=null,lease_token=null,updated_at=clock_timestamp() where id=delivery.id;
   exhausted:=array_append(exhausted,tenant.organization_id);
   continue;
  end if;
  -- Admission may wait on a counter; start the lease after those locks.
  stamp:=clock_timestamp(); token:=gen_random_uuid();
  update private.domain_event_deliveries d set status='leased',attempts=d.attempts+1,lease_token=token,leased_at=stamp,lease_expires_at=stamp+make_interval(secs=>lease_seconds),available_at=stamp+make_interval(secs=>lease_seconds),updated_at=stamp where id=delivery.id;
  claimed:=claimed+1;
  return query select delivery.id,token,stamp+make_interval(secs=>lease_seconds),delivery.attempts+1,private.domain_event_envelope(source);
 end loop;
end $$;
create or replace function private.read_automation_operations(org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare stamp timestamptz:=statement_timestamp(); queue jsonb; recent jsonb; executions jsonb; lag jsonb; missed jsonb; rules jsonb; failures jsonb;
begin
 perform private.require_automation_operations_admin(org);
 -- Cap candidates BEFORE expensive eligibility inspection. Older nonactionable
 -- domain events can remain pending by design; they are not actionable backlog.
 with candidates as materialized(select d.* from private.domain_event_deliveries d where d.organization_id=org and d.consumer='automation' and d.status in ('pending','leased') order by d.available_at,d.id limit 1001),
 sample as (select * from candidates order by available_at,id limit 1000),
 eligible as (select d.*, (d.attempts>=8 or exists(select 1 from public.automation_executions x where x.organization_id=org and x.delivery_id=d.id)
   or exists(select 1 from private.domain_events e join public.automation_rules r on r.organization_id=e.organization_id and r.trigger_type=e.event_type where e.organization_id=org and e.id=d.event_id and private.automation_rule_eligible(e,r))) actionable from sample d)
 select jsonb_build_object('sampled',count(*),'truncated',(select count(*)>1000 from candidates),
   'ready',count(*) filter(where actionable and available_at<=stamp),
   'leased',count(*) filter(where status='leased' and lease_expires_at>stamp),
   'capacityDeferred',count(*) filter(where capacity_reason is not null),
   'notificationDeferred',count(*) filter(where capacity_reason='notification_deferred_capacity'),
   'oldestCapacityDeferredAt',min(capacity_deferred_at),
   'retryScheduled',count(*) filter(where actionable and status='pending' and capacity_reason is null and attempts>0 and available_at>stamp),
   'ineligiblePending',count(*) filter(where not actionable and status='pending'),
   'oldestEligibleAt',min(created_at) filter(where actionable and available_at<=stamp)) into queue from eligible;
 with candidates as materialized(select d.status,d.error_code,d.attempts,d.completed_at,d.id from private.domain_event_deliveries d where d.organization_id=org and d.consumer='automation' and d.status in ('acknowledged','dead') and d.completed_at>=stamp-interval '24 hours' order by d.completed_at desc,d.id limit 1001), sample as(select * from candidates order by completed_at desc,id limit 1000)
 select jsonb_build_object('acknowledged',count(*) filter(where status='acknowledged'),'recovered',count(*) filter(where status='acknowledged' and attempts>1),'exhausted',count(*) filter(where error_code='retry_exhausted'),'guardrailTerminated',count(*) filter(where status='dead' and error_code='chain_limit'),'failed',count(*) filter(where status='dead' and error_code is distinct from 'retry_exhausted' and error_code is distinct from 'chain_limit'),'truncated',(select count(*)>1000 from candidates)) into recent from sample;
 queue:=queue||jsonb_build_object('recent',recent);
 with candidates as materialized(select status,error_code,started_at,id from public.automation_executions x where x.organization_id=org and x.started_at>=stamp-interval '24 hours' order by started_at desc,id desc limit 1001), sample as(select * from candidates order by started_at desc,id desc limit 1000)
 select jsonb_build_object('total',count(*),'completed',count(*) filter(where status='succeeded'),'skipped',count(*) filter(where status='skipped'),'running',count(*) filter(where status='running'),
   'guardrailTerminated',count(*) filter(where error_code in ('chain_limit','notification_fanout_limit')),
   'actionFailed',count(*) filter(where status in ('failed','partially_completed') and error_code is distinct from 'retry_exhausted' and error_code is distinct from 'delivery_failed' and error_code is distinct from 'chain_limit' and error_code is distinct from 'notification_fanout_limit'),
   'retryExhausted',count(*) filter(where error_code='retry_exhausted'),'deliveryFailed',count(*) filter(where error_code='delivery_failed'),'truncated',(select count(*)>1000 from candidates)) into executions from sample;
 with candidates as materialized(select o.* from private.automation_temporal_occurrences o where o.organization_id=org and o.created_at>=stamp-interval '24 hours' order by created_at desc,id limit 1001),
 sample as(select o.*,extract(epoch from e.occurred_at-o.threshold_at) seconds,e.occurred_at observed_at,e.after_snapshot#>>'{temporal,anchor}' deadline from candidates o join private.domain_events e on (e.organization_id,e.id)=(o.organization_id,o.event_id) order by o.created_at desc,o.id limit 1000)
 select jsonb_build_object('sampled',count(*),'truncated',(select count(*)>1000 from candidates),'maxSeconds',max(seconds),'latestSeconds',(array_agg(seconds order by created_at desc,id))[1],
 'withinWindow',count(*) filter(where trigger_type='ticket.sla_approaching' and seconds<=60 and observed_at<deadline::timestamptz),
 'lateBeforeDeadline',count(*) filter(where trigger_type='ticket.sla_approaching' and seconds>60 and observed_at<deadline::timestamptz)) into lag from sample;
 with candidates as materialized(select id from private.automation_missed_windows m where m.organization_id=org and m.observed_at>=stamp-interval '24 hours' order by observed_at desc,id limit 1001)
 select jsonb_build_object('missedWindow',least(count(*),1000),'missedTruncated',count(*)>1000) into missed from candidates;
 lag:=lag||missed;
 with candidates as materialized(select r.id,r.created_at,r.definition->>'name' name,r.version,r.trigger_type trigger,(r.definition#>>'{trigger,configuration,durationMinutes}')::integer duration,c.scanned_at
   from public.automation_rules r left join private.automation_temporal_cursors c on c.organization_id=r.organization_id and c.rule_id=r.id and c.rule_version=r.version
   where r.organization_id=org and r.enabled and r.archived_at is null and r.trigger_type in ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached')
   order by r.created_at,r.id limit 51), sample as(select * from candidates order by created_at,id limit 50)
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'trigger',trigger,'durationMinutes',duration,'lastScannedAt',scanned_at,
 'atRisk',trigger='ticket.sla_approaching' and (scanned_at is null or extract(epoch from stamp-scanned_at)>=duration*60 or coalesce((lag->>'maxSeconds')::numeric,0)>=duration*60)) order by created_at,id), '[]'),'truncated',(select count(*)>50 from candidates)) into rules from sample;
 return jsonb_build_object('now',stamp,'processingActive',(select active from private.automation_processing_state),'worker',private.automation_heartbeat('worker'),'discovery',private.automation_heartbeat('discovery'),
  'queue',queue,'executions',executions,'lag',lag,'temporalRules',rules->'rows','temporalRulesTruncated',rules->'truncated');
end $$;
commit;
