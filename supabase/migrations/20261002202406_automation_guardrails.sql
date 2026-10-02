begin;
-- Stage 12: fixed safety ceilings; no activation, retention deletion or remote work.

create function private.automation_safety_limits() returns jsonb language sql immutable set search_path='' as $$ select '{"activeRules":100,"windowSeconds":60,"executions":120,"notifications":120,"recipientNotifications":20,"claims":20,"retryClaims":5,"definitionBytes":262144}'::jsonb $$;
create table private.automation_capacity (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 resource text not null check(resource in ('executions','notifications','recipientNotifications','claims','retryClaims')),
 subject uuid not null default '00000000-0000-0000-0000-000000000000',
 window_started_at timestamptz not null, used integer not null check(used>=0),
 primary key(organization_id,resource,subject)
);
create table private.automation_tenant_schedule (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 last_claimed_at timestamptz not null default '-infinity',
 last_discovered_at timestamptz not null default '-infinity',
 active_epoch bigint not null default 0, queue_scan_at timestamptz, queue_scan_id uuid,
 last_was_retry boolean not null default false
);
alter table private.automation_capacity enable row level security;
alter table private.automation_tenant_schedule enable row level security;
revoke all on private.automation_capacity,private.automation_tenant_schedule from public,anon,authenticated,service_role;
insert into private.automation_tenant_schedule(organization_id) select id from public.organizations;
create function private.initialize_automation_schedule() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into private.automation_tenant_schedule(organization_id) values(new.id); return new;
end $$;
create trigger organizations_automation_schedule after insert on public.organizations for each row execute function private.initialize_automation_schedule();
create index automation_schedule_claim on private.automation_tenant_schedule(last_claimed_at,organization_id);
create index automation_schedule_discovery on private.automation_tenant_schedule(last_discovered_at,organization_id);

-- One reusable counter per tenant/resource/recipient, not one row per time window.
-- UPDATE predicate and row lock make admission atomic across workers.
create function private.take_automation_capacity(org uuid, resource_name text, recipient uuid default '00000000-0000-0000-0000-000000000000') returns boolean
language plpgsql set search_path='' as $$
declare ceiling integer; stamp timestamptz; entry private.automation_capacity;
begin
 begin
  ceiling:=(private.automation_safety_limits()->>resource_name)::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid capacity policy' using errcode='FF002';
 end;
 if ceiling is null or ceiling<1 or recipient is null then raise exception 'Invalid capacity policy' using errcode='FF002'; end if;
 insert into private.automation_capacity(organization_id,resource,subject,window_started_at,used) values(org,resource_name,recipient,clock_timestamp(),0) on conflict do nothing;
 select * into entry from private.automation_capacity c where (c.organization_id,c.resource,c.subject)=(org,resource_name,recipient) for update;
 stamp:=clock_timestamp();
 if stamp>=entry.window_started_at+interval '60 seconds' then
  update private.automation_capacity c set window_started_at=stamp,used=1 where (c.organization_id,c.resource,c.subject)=(org,resource_name,recipient); return true;
 end if;
 if entry.used>=ceiling then return false; end if;
 update private.automation_capacity c set used=used+1 where (c.organization_id,c.resource,c.subject)=(org,resource_name,recipient); return true;
end $$;

create function private.automation_definition_bytes(value jsonb) returns bigint language plpgsql immutable set search_path='' as $$
declare total bigint; item record;
begin
 case jsonb_typeof(value)
 when 'object' then
  total:=2; for item in select * from jsonb_each(value) loop total:=total+octet_length(to_jsonb(item.key)::text)+1+private.automation_definition_bytes(item.value)+1; end loop;
  return total-case when value='{}'::jsonb then 0 else 1 end;
 when 'array' then
  select 2+coalesce(sum(private.automation_definition_bytes(v)),0)+greatest(count(*)-1,0) into total from jsonb_array_elements(value) v; return total;
 else return octet_length(value::text);
 end case;
end $$;
create function private.enforce_automation_active_limit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.enabled and new.archived_at is null and (tg_op='INSERT' or not old.enabled or old.archived_at is not null) then
  -- Dedicated tenant row serializes all enabling transactions, before counting.
  update private.automation_tenant_schedule set active_epoch=active_epoch+1 where organization_id=new.organization_id;
  if (select count(*) from public.automation_rules where organization_id=new.organization_id and enabled and archived_at is null and id<>new.id)>=coalesce((private.automation_safety_limits()->>'activeRules')::integer,100) then
   raise exception 'Active automation safety limit reached' using errcode='FF001';
  end if;
 end if;
 return new;
end $$;
create trigger automation_active_limit before insert or update on public.automation_rules for each row execute function private.enforce_automation_active_limit();


create or replace function private.validate_automation_definition(definition jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare catalog jsonb:=private.automation_definition_catalog(); trigger_spec jsonb; field_spec jsonb; action_spec jsonb;
  item jsonb; candidate jsonb; op text; ids text[]; positions integer[]:='{}'; position integer; canonical_actions jsonb;
begin
  if not private.automation_bounded_json(definition) or not private.automation_object(definition,array['schemaVersion','name','description','trigger','conditions','actions']) then raise exception 'Invalid automation definition' using errcode='22023'; end if;
  if private.automation_definition_bytes(definition)>coalesce((private.automation_safety_limits()->>'definitionBytes')::integer,262144) then raise exception 'Definition safety limit exceeded' using errcode='FF004'; end if;
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
  if not private.take_automation_capacity(event.organization_id,'executions') then raise exception 'Execution delayed by capacity' using errcode='FF002'; end if;
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

alter table private.automation_command_contexts add column notification_count integer not null default 0;
alter table public.automation_executions drop constraint automation_executions_error_code_check;
alter table public.automation_executions add check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed','retry_exhausted','delivery_failed','notification_fanout_limit'));
alter table public.automation_execution_steps drop constraint automation_execution_steps_error_code_check;
alter table public.automation_execution_steps add check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed','retry_exhausted','delivery_failed','notification_fanout_limit'));
create function private.guard_automation_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare fanout integer;
begin
 if exists(select 1 from private.automation_command_contexts where transaction_id=pg_current_xact_id() and organization_id=new.organization_id) then
  update private.automation_command_contexts set notification_count=notification_count+1 where transaction_id=pg_current_xact_id() returning notification_count into fanout;
  if fanout>(private.automation_safety_limits()->>'notifications')::integer then raise exception 'Notification fanout safety limit' using errcode='FF005'; end if;
  if not private.take_automation_capacity(new.organization_id,'notifications') or not private.take_automation_capacity(new.organization_id,'recipientNotifications',new.recipient_id) then
   raise exception 'Notification delayed by capacity' using errcode='FF003';
  end if;
 end if;
 return new;
end $$;
create trigger notifications_automation_capacity after insert on public.notifications for each row execute function private.guard_automation_notification();


create or replace function private.execute_automation_ticket_step(execution_id uuid,token uuid,command jsonb)
returns public.automation_execution_steps language plpgsql security definer set search_path='' as $$
declare execution public.automation_executions%rowtype; step public.automation_execution_steps%rowtype;
  delivery private.domain_event_deliveries%rowtype; event private.domain_events%rowtype;
  rule public.automation_rules%rowtype; version public.automation_rule_versions%rowtype;
  processing private.automation_processing_state%rowtype; ticket public.tickets%rowtype;
  action jsonb; config jsonb; reference record; failure text; result_id uuid; result_type text:='ticket';
  previous_delivery text:=current_setting('app.domain_event_delivery',true); previous_token text:=current_setting('app.domain_event_lease',true);
  previous_claims text:=current_setting('request.jwt.claims',true); previous_subject text:=current_setting('request.jwt.claim.sub',true);
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  select * into execution from public.automation_executions e where e.id=$1;
  if not found then raise exception 'Execution unavailable' using errcode='42501'; end if;
  select * into delivery from private.domain_event_deliveries d where d.organization_id=execution.organization_id and d.id=execution.delivery_id for update;
  if not found or delivery.event_id<>execution.event_id or delivery.consumer<>'automation' or delivery.lease_token is distinct from token
    or delivery.status<>'leased' or delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  select * into rule from public.automation_rules r where r.organization_id=execution.organization_id and r.id=execution.rule_id for share;
  select * into execution from public.automation_executions e where e.id=$1 for update;
  select * into event from private.domain_events e where e.organization_id=execution.organization_id and e.id=execution.event_id;
  select * into version from public.automation_rule_versions v where v.organization_id=execution.organization_id and v.rule_id=execution.rule_id and v.version=execution.rule_version;
  if event.entity_type<>'ticket' or event.entity_type<>execution.entity_type or event.entity_id<>execution.entity_id
    or event.correlation_id<>execution.correlation_id or event.event_type<>execution.trigger_type or version.definition#>>'{trigger,type}'<>event.event_type then
    raise exception 'Invalid execution context' using errcode='42501';
  end if;
  select a into action from jsonb_array_elements(version.definition->'actions') a where a->>'id'=command#>>'{action,id}';
  if action is null or command is distinct from jsonb_build_object('organizationId',execution.organization_id,'entityId',execution.entity_id,'action',action) then
    raise exception 'Command does not match pinned action' using errcode='22023';
  end if;
  select * into step from public.automation_execution_steps s where s.organization_id=execution.organization_id and s.execution_id=execution.id and s.action_id=action->>'id' for update;
  if not found or step.position<>(action->>'position')::integer or step.action_type<>action->>'type' then raise exception 'Invalid execution step' using errcode='42501'; end if;
  -- A successful receipt is immutable and returned before considering current
  -- ticket state. Never replay a completed note or mutation.
  if step.status in ('succeeded','failed','not_attempted') then return step; end if;
  if execution.status<>'running' or step.status<>'pending' or exists(select 1 from public.automation_execution_steps s where s.execution_id=execution.id and s.position<step.position and s.status<>'succeeded') then
    raise exception 'Action is not next in execution order' using errcode='55000';
  end if;
  select * into processing from private.automation_processing_state for share;
  if not processing.active or processing.generation<>execution.processing_generation then failure:='processing_inactive';
  elsif not rule.enabled or rule.archived_at is not null or rule.version<>execution.rule_version then failure:='rule_unavailable'; end if;
  -- Budget is shared by every execution in the persisted correlation chain.
  update private.automation_chains c set action_count=action_count+1 where c.organization_id=execution.organization_id and c.correlation_id=execution.correlation_id and c.action_count<100;
  if not found then failure:='chain_limit'; end if;
  select * into ticket from public.tickets t where t.organization_id=execution.organization_id and t.id=execution.entity_id for update;
  if not found or ticket.revision<>execution.expected_entity_revision then failure:=coalesce(failure,'stale_entity'); end if;
  -- Recheck time after all blocking locks; expired leases never authorize work.
  if delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  update public.automation_execution_steps s set status='running',attempts=1,started_at=clock_timestamp() where s.id=step.id returning * into step;
  update public.automation_executions e set actions_attempted=actions_attempted+1 where e.id=execution.id;
  config:=action->'configuration'; result_id:=ticket.id;
  -- This subtransaction contains BOTH mutation and receipt. An exception from
  -- any ticket/history/notification/outbox trigger rolls the mutation back.
  begin
    if failure is null then
      for reference in select * from jsonb_each(private.automation_definition_catalog()#>array['actions',action->>'type','configuration']) loop
        if reference.value#>>'{value,kind}'='reference' and not private.automation_ticket_reference(execution.organization_id,reference.value#>>'{value,resource}',(config->>reference.key)::uuid,true) then failure:='unavailable_reference'; end if;
      end loop;
    end if;
    if failure is null then
      if action->>'type'='set_status' and config->>'status' not in ('resolved','closed') and ticket.status in ('resolved','closed') and ticket.assigned_technician_id is null and (select count(*) from (select 1 from public.organization_memberships where organization_id=execution.organization_id and status='active' and (role in ('technician','administrator') or user_id=ticket.requester_id) limit 121) recipients)>120 then raise exception 'Notification fanout safety limit' using errcode='FF005'; end if;
      insert into private.automation_command_contexts values(pg_current_xact_id(),execution.organization_id,execution.id,step.id);
      perform set_config('app.domain_event_delivery',delivery.id::text,true);
      perform set_config('app.domain_event_lease',token::text,true);
      -- Existing notification/history triggers use auth.uid(). System work has
      -- no human subject, including when a service JWT supplies one.
      perform set_config('request.jwt.claims',(coalesce(nullif(previous_claims,''),'{}')::jsonb-'sub')::text,true);
      perform set_config('request.jwt.claim.sub','',true);
      case action->>'type'
        when 'assign_technician' then update public.tickets set assigned_technician_id=(config->>'technicianId')::uuid where organization_id=execution.organization_id and id=ticket.id;
        when 'assign_team' then update public.tickets set team_id=(config->>'teamId')::uuid,routing_mode='manual' where organization_id=execution.organization_id and id=ticket.id;
        when 'set_priority' then update public.tickets set priority=(config->>'priority')::public.ticket_priority where organization_id=execution.organization_id and id=ticket.id;
        when 'set_status' then update public.tickets set status=(config->>'status')::public.ticket_status where organization_id=execution.organization_id and id=ticket.id;
        when 'set_category' then
          -- The established action accepts a category only. Clear an old child
          -- on a category change; preserve a child when the category is equal.
          update public.tickets set category_id=(config->>'categoryId')::uuid,
            subcategory_id=case when category_id=(config->>'categoryId')::uuid then subcategory_id else null end
          where organization_id=execution.organization_id and id=ticket.id;
        when 'add_internal_note' then
          insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body,author_type,automation_execution_id,automation_step_id,automation_name)
          values(execution.organization_id,ticket.id,null,'internal_note',config->>'body','automation',execution.id,step.id,execution.rule_name) returning id into result_id;
          result_type:='ticket_message';
        when 'send_notification' then result_id:=private.enqueue_automation_notification(); result_type:='notification';
        else failure:='unsupported_action';
      end case;
      delete from private.automation_command_contexts where transaction_id=pg_current_xact_id();
      perform set_config('app.domain_event_delivery',coalesce(previous_delivery,''),true);
      perform set_config('app.domain_event_lease',coalesce(previous_token,''),true);
      perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
      perform set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
    end if;
    if failure is null then
      if delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease expired' using errcode='42501'; end if;
      update public.automation_execution_steps s set status='succeeded',completed_at=clock_timestamp(),result=jsonb_build_object('code','completed','entityType',result_type,'entityId',result_id) where s.id=step.id returning * into step;
      update public.automation_executions e set expected_entity_revision=(select revision from public.tickets where organization_id=e.organization_id and id=e.entity_id) where e.id=execution.id;
    end if;
  exception
    when sqlstate 'FF003' or sqlstate 'FF002' or serialization_failure or deadlock_detected or lock_not_available then raise;
    when sqlstate 'FF005' then failure:='notification_fanout_limit';
    when no_data_found then failure:='unavailable_reference';
    when others then
    -- Never persist SQLERRM, detail, note bodies, or provider responses.
    failure:='action_failed';
  end;
  if failure is not null then
    update public.automation_execution_steps s set status='failed',completed_at=clock_timestamp(),error_code=failure where s.id=step.id returning * into step;
    update public.automation_execution_steps s set status='not_attempted' where s.execution_id=execution.id and s.position>step.position and s.status='pending';
    update public.automation_executions e set status=case when exists(select 1 from public.automation_execution_steps s where s.execution_id=e.id and s.status='succeeded') then 'partially_completed' else 'failed' end,error_code=failure,completed_at=clock_timestamp() where e.id=execution.id;
  elsif not exists(select 1 from public.automation_execution_steps s where s.execution_id=execution.id and s.status<>'succeeded') then
    update public.automation_executions e set status='succeeded',completed_at=clock_timestamp() where e.id=execution.id;
  end if;
  return step;
end $$;

alter table private.domain_event_deliveries add column capacity_deferred_at timestamptz;
alter table private.domain_event_deliveries add column capacity_reason text check(capacity_reason in ('execution_deferred_capacity','notification_deferred_capacity','worker_deferred_capacity'));


create or replace function private.finish_domain_event_delivery(delivery_id uuid,token uuid,outcome text,failure_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; stamp timestamptz:=clock_timestamp(); next_status text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if outcome='deferred' then
    if failure_code is null or failure_code not in ('execution_deferred_capacity','notification_deferred_capacity','worker_deferred_capacity') then raise exception 'Invalid capacity outcome' using errcode='22023'; end if;
    select * into delivery from private.domain_event_deliveries where id=delivery_id for update;
    if not found or delivery.consumer<>'automation' or token is null or delivery.lease_token is distinct from token then return false; end if;
    if delivery.status='pending' and delivery.capacity_reason=failure_code then return true; end if;
    if delivery.status<>'leased' or delivery.lease_expires_at<=clock_timestamp() then return false; end if;
    update private.domain_event_deliveries set status='pending',attempts=greatest(0,attempts-1),
      capacity_reason=failure_code,capacity_deferred_at=coalesce(capacity_deferred_at,clock_timestamp()),
      available_at=clock_timestamp()+interval '60 seconds',leased_at=null,lease_expires_at=null,updated_at=clock_timestamp() where id=delivery.id;
    return true;
  end if;
  if outcome is null or outcome not in ('acknowledged','retry','failed')
    or (outcome='acknowledged' and failure_code is not null)
    or (outcome<>'acknowledged' and (failure_code is null or failure_code not in ('transient_failure','invalid_event','unsupported_event','permanent_failure','chain_limit','invalid_configuration','planner_mismatch','authorization_failed'))) then
    raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  select * into delivery from private.domain_event_deliveries where id=delivery_id for update;
  stamp:=clock_timestamp(); -- Recheck expiry after any lock wait, not before it.
  if not found or token is null or delivery.lease_token is distinct from token then return false; end if;
  next_status:=case when outcome='acknowledged' then 'acknowledged' when outcome='failed' or delivery.attempts>=8 then 'dead' else 'pending' end;
  if delivery.status<>'leased' then return delivery.status=next_status and (delivery.error_code is not distinct from failure_code or (delivery.error_code='retry_exhausted' and outcome='retry' and delivery.attempts>=8)); end if;
  if delivery.lease_expires_at<=stamp then return false; end if;
  update private.domain_event_deliveries set status=next_status,error_code=failure_code,capacity_reason=null,capacity_deferred_at=null,
    available_at=case when next_status='pending' then stamp+make_interval(secs=>least(3600,30*power(2,delivery.attempts-1))::integer) else available_at end,
    completed_at=case when next_status in ('acknowledged','dead') then stamp else null end,
    leased_at=null,lease_expires_at=null,updated_at=stamp where id=delivery.id;
  return true;
end $$;

create or replace function private.claim_automation_events(batch_size integer,lease_seconds integer)
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries; stamp timestamptz:=clock_timestamp(); token uuid; tenant private.automation_tenant_schedule; slot integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  if batch_size is null or batch_size not between 1 and 20 or lease_seconds is null or lease_seconds not between 30 and 900 then raise exception 'Invalid claim parameters' using errcode='22023'; end if;
  if not (select active from private.automation_processing_state) then return; end if;
  for slot in 1..batch_size loop
    select s.* into tenant from private.automation_tenant_schedule s
    where exists(select 1 from private.domain_event_deliveries d
      where d.organization_id=s.organization_id and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp)
    order by s.last_claimed_at,s.organization_id limit 1 for update of s skip locked;
    if not found then exit; end if;
    update private.automation_tenant_schedule set last_claimed_at=clock_timestamp() where organization_id=tenant.organization_id;
    with candidates as materialized(select d.id from private.domain_event_deliveries d where d.organization_id=tenant.organization_id and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp and (tenant.queue_scan_at is null or (d.available_at,d.id)>(tenant.queue_scan_at,tenant.queue_scan_id)) order by d.available_at,d.id limit 100)
    select d.* into delivery from candidates join private.domain_event_deliveries d using(id) join private.domain_events e on (e.organization_id,e.id)=(d.organization_id,d.event_id)
    where d.organization_id=tenant.organization_id and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp
      and (d.attempts>=8 or exists(select 1 from public.automation_executions x where x.organization_id=d.organization_id and x.delivery_id=d.id)
       or exists(select 1 from public.automation_rules r where r.organization_id=e.organization_id and r.trigger_type=e.event_type and private.automation_rule_eligible(e,r)))
    order by ((d.attempts>0)=tenant.last_was_retry),d.available_at,d.id limit 1 for update of d skip locked;
    if not found then
      select d.available_at,d.id into tenant.queue_scan_at,tenant.queue_scan_id from (select d.available_at,d.id from private.domain_event_deliveries d where d.organization_id=tenant.organization_id and d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp and (tenant.queue_scan_at is null or (d.available_at,d.id)>(tenant.queue_scan_at,tenant.queue_scan_id)) order by d.available_at,d.id limit 100) d order by d.available_at desc,d.id desc limit 1;
      update private.automation_tenant_schedule set queue_scan_at=tenant.queue_scan_at,queue_scan_id=tenant.queue_scan_id where organization_id=tenant.organization_id;
      continue;
    end if;
    if delivery.attempts>=8 then
      update private.domain_event_deliveries set status='dead',error_code='retry_exhausted',completed_at=stamp,updated_at=stamp,leased_at=null,lease_expires_at=null,lease_token=null where id=delivery.id;
      continue;
    end if;
    update private.automation_tenant_schedule set last_was_retry=(delivery.attempts>0) where organization_id=delivery.organization_id;
    if (delivery.attempts>0 and not private.take_automation_capacity(delivery.organization_id,'retryClaims')) or not private.take_automation_capacity(delivery.organization_id,'claims') then
      update private.domain_event_deliveries set status='pending',capacity_reason='worker_deferred_capacity',capacity_deferred_at=coalesce(capacity_deferred_at,stamp),available_at=stamp+interval '60 seconds',leased_at=null,lease_expires_at=null,lease_token=null where id=delivery.id;
      continue;
    end if;
    token:=gen_random_uuid();
    update private.domain_event_deliveries d set status='leased',attempts=d.attempts+1,lease_token=token,leased_at=stamp,lease_expires_at=stamp+make_interval(secs=>lease_seconds),available_at=stamp+make_interval(secs=>lease_seconds),updated_at=stamp where id=delivery.id;
    return query select delivery.id,token,stamp+make_interval(secs=>lease_seconds),delivery.attempts+1,private.domain_event_envelope(e) from private.domain_events e where e.organization_id=delivery.organization_id and e.id=delivery.event_id;
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
 select jsonb_build_object('acknowledged',count(*) filter(where status='acknowledged'),'recovered',count(*) filter(where status='acknowledged' and attempts>1),'exhausted',count(*) filter(where error_code='retry_exhausted'),'failed',count(*) filter(where status='dead' and error_code is distinct from 'retry_exhausted'),'truncated',(select count(*)>1000 from candidates)) into recent from sample;
 queue:=queue||jsonb_build_object('recent',recent);
 with candidates as materialized(select status,error_code,started_at,id from public.automation_executions x where x.organization_id=org and x.started_at>=stamp-interval '24 hours' order by started_at desc,id desc limit 1001), sample as(select * from candidates order by started_at desc,id desc limit 1000)
 select jsonb_build_object('total',count(*),'completed',count(*) filter(where status='succeeded'),'skipped',count(*) filter(where status='skipped'),'running',count(*) filter(where status='running'),
   'guardrailTerminated',count(*) filter(where error_code in ('chain_limit','notification_fanout_limit')),
   'actionFailed',count(*) filter(where status in ('failed','partially_completed') and error_code is distinct from 'retry_exhausted' and error_code is distinct from 'delivery_failed' and error_code not in ('chain_limit','notification_fanout_limit')),
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

create or replace function private.finish_automation_run(run_id uuid,outcome text,metrics jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare entry record; run private.automation_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if outcome is null or outcome not in ('succeeded','degraded','failed') or jsonb_typeof(metrics) is distinct from 'object'
   or not private.automation_object(metrics,array['claimed','executions','failures','retried','deferred','acknowledged','rules','examined','emitted','duplicates','capacityDeferred']) then raise exception 'Invalid run result' using errcode='22023'; end if;
 for entry in select * from jsonb_each(metrics) loop
   if not private.automation_value_valid(entry.value,'{"kind":"number","integer":true,"min":0,"max":100000}') then raise exception 'Invalid run counts' using errcode='22023'; end if;
 end loop;
 select * into run from private.automation_runs r where r.id=run_id for update;
 if not found then return false; end if;
 if run.outcome<>'running' then return run.outcome=outcome and run.metrics=metrics; end if;
 update private.automation_runs r set outcome=$2,metrics=$3,completed_at=clock_timestamp() where r.id=run_id;
 return true;
end $$;

revoke all on function private.automation_safety_limits(),private.initialize_automation_schedule(),private.take_automation_capacity(uuid,text,uuid),private.automation_definition_bytes(jsonb),private.enforce_automation_active_limit(),private.guard_automation_notification() from public,anon,authenticated,service_role;
commit;
