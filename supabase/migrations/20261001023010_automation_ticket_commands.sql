-- Trusted ticket adapter. Authority exists only inside a validated command.
create function private.current_automation_command(org uuid,target uuid) returns public.automation_executions
language sql security definer set search_path='' as $$
  select e.* from private.automation_command_contexts c
  join public.automation_executions e on (e.organization_id,e.id)=(c.organization_id,c.execution_id)
  join public.automation_execution_steps s on (s.organization_id,s.execution_id,s.id)=(c.organization_id,c.execution_id,c.step_id)
  join private.domain_event_deliveries d on (d.organization_id,d.id,d.event_id)=(e.organization_id,e.delivery_id,e.event_id)
  where c.transaction_id=pg_current_xact_id() and e.organization_id=org and e.entity_type='ticket' and e.entity_id=target
    and e.status='running' and s.status='running' and d.status='leased' and d.lease_expires_at>clock_timestamp()
    and current_setting('role',true)='service_role';
$$;

-- Definer rights are needed only to inspect the private authority record. This
-- trigger neither writes tickets nor grants callers additional table access.
create or replace function private.restrict_employee_ticket_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='service_role' then
    if (private.current_automation_command(old.organization_id,old.id)).id is null then
      raise exception 'Validated automation command required' using errcode='42501';
    end if;
  elsif not (select private.can_work_tickets(old.organization_id)) then
    if old.requester_id is distinct from (select auth.uid()) or old.status not in ('resolved','closed') or new.status<>'open'
      or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
      raise exception 'Only a resolved or closed request may be reopened';
    end if;
  end if;
  return new;
end $$;

alter table public.ticket_messages alter column author_id drop not null;
alter table public.ticket_messages add column author_type text not null default 'member' check(author_type in ('member','automation'));
alter table public.ticket_messages add column automation_execution_id uuid;
alter table public.ticket_messages add column automation_step_id uuid;
alter table public.ticket_messages add column automation_name text;
alter table public.ticket_messages add foreign key(organization_id,automation_execution_id,automation_step_id) references public.automation_execution_steps(organization_id,execution_id,id);
alter table public.ticket_messages add unique(automation_step_id);
alter table public.ticket_messages add constraint ticket_message_authorship check(
  (author_type='member' and author_id is not null and automation_execution_id is null and automation_step_id is null and automation_name is null)
  or (author_type='automation' and author_id is null and kind='internal_note' and automation_execution_id is not null and automation_step_id is not null and automation_name is not null)
);
create index ticket_message_execution on public.ticket_messages(organization_id,automation_execution_id,automation_step_id) where automation_execution_id is not null;
-- Existing client INSERT column allowlist deliberately excludes provenance.
revoke insert(author_type,automation_execution_id,automation_step_id,automation_name),update(author_type,automation_execution_id,automation_step_id,automation_name) on public.ticket_messages from authenticated,anon;
create function private.guard_automation_note() returns trigger
language plpgsql security definer set search_path='' as $$
declare execution public.automation_executions; context private.automation_command_contexts;
begin
  if tg_op<>'INSERT' and old.author_type='automation' then
    raise exception 'Automation note receipt is immutable' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  if current_setting('role',true)='service_role' and new.author_type<>'automation' then
    raise exception 'Validated automation note required' using errcode='42501';
  end if;
  if new.author_type='automation' then
    execution:=private.current_automation_command(new.organization_id,new.ticket_id);
    select * into context from private.automation_command_contexts where transaction_id=pg_current_xact_id();
    if execution.id is null or new.automation_execution_id is distinct from execution.id or new.automation_step_id is distinct from context.step_id
      or new.automation_name is distinct from execution.rule_name or not exists(select 1 from public.automation_execution_steps where id=context.step_id and action_type='add_internal_note') then
      raise exception 'Invalid automation note authority' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger ticket_messages_automation_author before insert or update or delete on public.ticket_messages for each row execute function private.guard_automation_note();

-- Add provenance to existing history/audit records without replacing their
-- allowlists, activity semantics, or immutable audit implementation.
create function private.stamp_automation_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
declare execution public.automation_executions; target uuid;
begin
  if tg_table_name='domain_events' then target:=new.entity_id;
  elsif tg_table_name='ticket_activity' then target:=new.ticket_id;
  elsif new.entity_type='tickets' then target:=new.entity_id;
  elsif new.entity_type='ticket_messages' then
    select ticket_id into target from public.ticket_messages where organization_id=new.organization_id and id=new.entity_id;
  else return new;
  end if;
  execution:=private.current_automation_command(new.organization_id,target);
  if execution.id is not null then
    if tg_table_name='domain_events' then
      if new.causation_id is distinct from execution.event_id or new.correlation_id<>execution.correlation_id or new.entity_type<>execution.entity_type then raise exception 'Invalid automation event cause' using errcode='42501'; end if;
      new.actor_type:='automation'; new.actor_id:=null; new.automation_execution_id:=execution.id;
    elsif tg_table_name='ticket_activity' then
      new.actor_id:=null; new.details:=new.details||jsonb_build_object('automationExecutionId',execution.id,'automationName',execution.rule_name);
    else new.actor_id:=null; new.actor_name:='Automation: '||execution.rule_name;
    end if;
  elsif tg_table_name='domain_events' then
    if new.actor_type='automation' or new.automation_execution_id is not null then raise exception 'Invalid automation event authority' using errcode='42501'; end if;
  end if;
  return new;
end $$;
create trigger domain_event_automation_actor before insert on private.domain_events for each row execute function private.stamp_automation_provenance();
create trigger ticket_activity_automation_actor before insert on public.ticket_activity for each row execute function private.stamp_automation_provenance();
create trigger audit_automation_actor before insert on public.audit_events for each row execute function private.stamp_automation_provenance();

-- The command is an assertion of the caller's plan, not a source of authority:
-- {organizationId,entityId,action} must exactly equal the pinned stored action.
create function private.execute_automation_ticket_step(execution_id uuid,token uuid,command jsonb)
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
  exception when others then
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
create function public.execute_automation_ticket_step(execution_id uuid,token uuid,command jsonb)
returns public.automation_execution_steps language sql security invoker set search_path='' as $$ select private.execute_automation_ticket_step(execution_id,token,command); $$;
revoke all on function private.current_automation_command(uuid,uuid),private.restrict_employee_ticket_update(),private.guard_automation_note(),private.stamp_automation_provenance(),private.execute_automation_ticket_step(uuid,uuid,jsonb),public.execute_automation_ticket_step(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.execute_automation_ticket_step(uuid,uuid,jsonb),public.execute_automation_ticket_step(uuid,uuid,jsonb) to service_role;
