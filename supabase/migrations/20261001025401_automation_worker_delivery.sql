-- Stage 5 transport/orchestration support. Never activates processing.
alter table public.automation_executions drop constraint automation_executions_error_code_check;
alter table public.automation_executions add check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed','retry_exhausted','delivery_failed'));
alter table public.automation_execution_steps drop constraint automation_execution_steps_error_code_check;
alter table public.automation_execution_steps add check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed','retry_exhausted','delivery_failed'));
alter table private.domain_event_deliveries drop constraint domain_event_deliveries_error_code_check;
alter table private.domain_event_deliveries add check(error_code in ('transient_failure','invalid_event','unsupported_event','permanent_failure','retry_exhausted','chain_limit','invalid_configuration','planner_mismatch','authorization_failed'));

create function private.close_automation_delivery_executions(delivery uuid,reason text) returns void
language plpgsql set search_path='' as $$
declare execution public.automation_executions;
begin
  if reason not in ('retry_exhausted','delivery_failed') then raise exception 'Invalid terminal reason' using errcode='22023'; end if;
  for execution in select * from public.automation_executions where delivery_id=delivery and status='running' order by id for update loop
    update public.automation_execution_steps set status='not_attempted' where execution_id=execution.id and status='pending';
    update public.automation_execution_steps set status='failed',completed_at=clock_timestamp(),error_code=reason where execution_id=execution.id and status='running';
    update public.automation_executions e set status=case when exists(select 1 from public.automation_execution_steps s where s.execution_id=e.id and s.status='succeeded') then 'partially_completed' else 'failed' end,
      completed_at=clock_timestamp(),error_code=reason where e.id=execution.id;
    raise log '%',jsonb_build_object('component','automation','result','delivery_terminal','code',reason,'deliveryId',delivery,'executionId',execution.id,'organizationId',execution.organization_id,'ruleId',execution.rule_id,'ruleVersion',execution.rule_version,'eventId',execution.event_id,'eventType',execution.trigger_type,'correlationId',execution.correlation_id);
  end loop;
end $$;
create function private.automation_delivery_terminal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.consumer='automation' then
    if new.status='dead' then
      if new.error_code='retry_exhausted' or (new.attempts>=8 and new.error_code='transient_failure') then new.error_code:='retry_exhausted'; end if;
      perform private.close_automation_delivery_executions(new.id,case when new.error_code='retry_exhausted' then 'retry_exhausted' else 'delivery_failed' end);
    elsif new.status='acknowledged' and exists(select 1 from public.automation_executions where delivery_id=new.id and status='running') then
      raise exception 'Unfinished automation execution' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
create trigger automation_delivery_terminal before update on private.domain_event_deliveries for each row execute function private.automation_delivery_terminal();
-- Upgrade repair: existing dead deliveries must not leave running history behind.
do $$ declare d record; begin
  for d in select id,error_code,attempts from private.domain_event_deliveries where consumer='automation' and status in ('dead','acknowledged') loop
    perform private.close_automation_delivery_executions(d.id,case when d.error_code='retry_exhausted' or (d.attempts>=8 and d.error_code='transient_failure') then 'retry_exhausted' else 'delivery_failed' end);
  end loop;
end $$;

-- Discovery repeats the Stage 4 eligibility predicate, not mutation authority.
-- begin_automation_execution remains the independent admission check.
create function private.automation_rule_eligible(event private.domain_events,rule public.automation_rules) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.automation_processing_state p
    join public.automation_rule_versions v on (v.organization_id,v.rule_id,v.version)=(rule.organization_id,rule.id,rule.version)
    join private.automation_version_visibility x on (x.organization_id,x.rule_id,x.version)=(v.organization_id,v.rule_id,v.version)
    where p.active and rule.enabled and rule.archived_at is null and rule.organization_id=event.organization_id and rule.trigger_type=event.event_type
      and event.occurred_at>greatest(p.activated_at,rule.enabled_at,v.created_at)
      and (x.created_transaction=event.capture_transaction or pg_visible_in_snapshot(x.created_transaction,event.capture_snapshot))
      and (p.activation_transaction=event.capture_transaction or pg_visible_in_snapshot(p.activation_transaction,event.capture_snapshot)));
$$;
create function private.claim_automation_events(batch_size integer,lease_seconds integer)
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries; stamp timestamptz:=clock_timestamp(); token uuid;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  if batch_size is null or batch_size not between 1 and 20 or lease_seconds is null or lease_seconds not between 30 and 900 then raise exception 'Invalid claim parameters' using errcode='22023'; end if;
  if not (select active from private.automation_processing_state) then return; end if;
  for delivery in select d.* from private.domain_event_deliveries d join private.domain_events e on (e.organization_id,e.id)=(d.organization_id,d.event_id)
    where d.consumer='automation' and d.status in ('pending','leased') and d.available_at<=stamp and
      (d.attempts>=8 or exists(select 1 from public.automation_executions x where x.organization_id=d.organization_id and x.delivery_id=d.id)
       or exists(select 1 from public.automation_rules r where r.organization_id=e.organization_id and r.trigger_type=e.event_type and private.automation_rule_eligible(e,r)))
    order by d.available_at,d.id limit batch_size for update of d skip locked loop
    if delivery.attempts>=8 then
      update private.domain_event_deliveries set status='dead',error_code='retry_exhausted',completed_at=stamp,updated_at=stamp,leased_at=null,lease_expires_at=null,lease_token=null where id=delivery.id;
      continue;
    end if;
    token:=gen_random_uuid();
    update private.domain_event_deliveries d set status='leased',attempts=d.attempts+1,lease_token=token,leased_at=stamp,lease_expires_at=stamp+make_interval(secs=>lease_seconds),available_at=stamp+make_interval(secs=>lease_seconds),updated_at=stamp where id=delivery.id;
    return query select delivery.id,token,stamp+make_interval(secs=>lease_seconds),delivery.attempts+1,private.domain_event_envelope(e) from private.domain_events e where e.organization_id=delivery.organization_id and e.id=delivery.event_id;
  end loop;
end $$;
create function private.automation_worker_lease(delivery_id uuid,token uuid) returns private.domain_event_deliveries
language plpgsql set search_path='' as $$
declare delivery private.domain_event_deliveries;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  select * into delivery from private.domain_event_deliveries d where d.id=$1 for update;
  if not found or delivery.consumer<>'automation' or delivery.status<>'leased' or delivery.lease_token is distinct from token or delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  return delivery;
end $$;
create function private.discover_automation_rules(delivery_id uuid,token uuid,after_created_at timestamptz,after_rule_id uuid,batch_size integer)
returns table(rule jsonb,sort_created_at timestamptz,rule_id uuid)
language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries:=private.automation_worker_lease(delivery_id,token); event private.domain_events;
begin
  if batch_size is null or batch_size not between 1 and 50 or (after_created_at is null)<>(after_rule_id is null) then raise exception 'Invalid discovery page' using errcode='22023'; end if;
  select * into event from private.domain_events where organization_id=delivery.organization_id and id=delivery.event_id;
  return query select jsonb_build_object('id',r.id,'organizationId',r.organization_id,'enabled',v.enabled,'version',v.version,'createdBy',r.created_by,'createdAt',r.created_at,'updatedAt',v.created_at,'definition',v.definition),r.created_at,r.id
    from public.automation_rules r
    left join public.automation_executions x on x.organization_id=r.organization_id and x.rule_id=r.id and x.event_id=event.id
    join public.automation_rule_versions v on (v.organization_id,v.rule_id,v.version)=(r.organization_id,r.id,coalesce(x.rule_version,r.version))
    where r.organization_id=event.organization_id and (x.id is not null or private.automation_rule_eligible(event,r))
      and (after_created_at is null or (r.created_at,r.id)>(after_created_at,after_rule_id))
    order by r.created_at,r.id limit batch_size;
end $$;
create function private.get_automation_execution(execution_id uuid,token uuid) returns public.automation_executions
language plpgsql security definer set search_path='' as $$
declare execution public.automation_executions; delivery private.domain_event_deliveries;
begin
  select * into execution from public.automation_executions e where e.id=$1;
  if not found then raise exception 'Execution unavailable' using errcode='42501'; end if;
  delivery:=private.automation_worker_lease(execution.delivery_id,token);
  -- Refresh after the delivery lock; a command may have committed while waiting.
  select * into execution from public.automation_executions e where e.id=$1;
  if delivery.organization_id<>execution.organization_id then raise exception 'Execution unavailable' using errcode='42501'; end if;
  return execution;
end $$;
create function public.claim_automation_events(batch_size integer default 5,lease_seconds integer default 120)
returns table(delivery_id uuid,lease_token uuid,lease_expires_at timestamptz,attempts integer,event jsonb)
language sql security invoker set search_path='' as $$ select * from private.claim_automation_events(batch_size,lease_seconds); $$;
create function public.discover_automation_rules(delivery_id uuid,token uuid,after_created_at timestamptz default null,after_rule_id uuid default null,batch_size integer default 50)
returns table(rule jsonb,sort_created_at timestamptz,rule_id uuid)
language sql security invoker set search_path='' as $$ select * from private.discover_automation_rules(delivery_id,token,after_created_at,after_rule_id,batch_size); $$;
create function public.get_automation_execution(execution_id uuid,token uuid) returns public.automation_executions
language sql security invoker set search_path='' as $$ select private.get_automation_execution(execution_id,token); $$;
revoke all on function private.close_automation_delivery_executions(uuid,text),private.automation_delivery_terminal(),private.automation_rule_eligible(private.domain_events,public.automation_rules),private.claim_automation_events(integer,integer),private.automation_worker_lease(uuid,uuid),private.discover_automation_rules(uuid,uuid,timestamptz,uuid,integer),private.get_automation_execution(uuid,uuid),public.claim_automation_events(integer,integer),public.discover_automation_rules(uuid,uuid,timestamptz,uuid,integer),public.get_automation_execution(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.claim_automation_events(integer,integer),private.discover_automation_rules(uuid,uuid,timestamptz,uuid,integer),private.get_automation_execution(uuid,uuid),public.claim_automation_events(integer,integer),public.discover_automation_rules(uuid,uuid,timestamptz,uuid,integer),public.get_automation_execution(uuid,uuid) to service_role;

-- Retain the existing fenced backoff protocol; accept bounded worker failure codes.
create or replace function private.finish_domain_event_delivery(delivery_id uuid,token uuid,outcome text,failure_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; stamp timestamptz:=clock_timestamp(); next_status text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
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
  update private.domain_event_deliveries set status=next_status,error_code=failure_code,
    available_at=case when next_status='pending' then stamp+make_interval(secs=>least(3600,30*power(2,delivery.attempts-1))::integer) else available_at end,
    completed_at=case when next_status in ('acknowledged','dead') then stamp else null end,
    leased_at=null,lease_expires_at=null,updated_at=stamp where id=delivery.id;
  return true;
end $$;
