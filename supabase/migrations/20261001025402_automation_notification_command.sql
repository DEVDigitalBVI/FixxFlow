-- Reuse notification inbox + email outbox. No provider call occurs here.
create function private.enqueue_automation_notification() returns uuid
language plpgsql set search_path='' as $$
declare context private.automation_command_contexts; execution public.automation_executions;
  step public.automation_execution_steps; ticket public.tickets; action jsonb;
  recipient uuid; result uuid; notification_event_key text; staff boolean;
begin
  select * into context from private.automation_command_contexts where transaction_id=pg_current_xact_id();
  select * into execution from public.automation_executions where organization_id=context.organization_id and id=context.execution_id;
  if execution.id is null or (private.current_automation_command(execution.organization_id,execution.entity_id)).id is null then raise exception 'Notification execution unavailable' using errcode='42501'; end if;
  select * into step from public.automation_execution_steps where organization_id=execution.organization_id and execution_id=execution.id and id=context.step_id;
  select v.definition->'actions'->step.position into action from public.automation_rule_versions v where (v.organization_id,v.rule_id,v.version)=(execution.organization_id,execution.rule_id,execution.rule_version);
  if step.action_type<>'send_notification' or action->>'id'<>step.action_id or action->>'type'<>'send_notification' or action#>>'{configuration,template}'<>'ticket_update' then raise exception 'Invalid notification action' using errcode='22023'; end if;
  select * into ticket from public.tickets where organization_id=execution.organization_id and id=execution.entity_id;
  case action#>>'{configuration,recipient}'
    when 'requester' then recipient:=ticket.requester_id; staff:=false;
    when 'assigned_technician' then recipient:=ticket.assigned_technician_id; staff:=true;
    else raise exception 'Invalid notification recipient' using errcode='22023';
  end case;
  -- Mirror existing ticket access: active same-tenant requester or ticket worker.
  -- Never use the service identity's can_view_ticket result for another person.
  perform 1 from public.organization_memberships m where m.organization_id=execution.organization_id and m.user_id=recipient and m.status='active'
    and (m.role in ('technician','administrator') or (not staff and m.user_id=ticket.requester_id)) for share;
  if not found then raise exception 'Notification recipient unavailable' using errcode='P0002'; end if;
  notification_event_key:='automation:'||execution.id||':'||step.id||':'||recipient;
  perform private.enqueue_notification(execution.organization_id,recipient,null,ticket.id,null,'automation_update','Ticket #'||ticket.ticket_number||' update',staff,notification_event_key);
  select n.id into result from public.notifications n where n.organization_id=execution.organization_id and n.recipient_id=recipient and n.event_key=notification_event_key;
  if result is null then raise exception 'Notification enqueue unavailable' using errcode='P0002'; end if;
  return result;
end $$;
revoke all on function private.enqueue_automation_notification() from public,anon,authenticated,service_role;

-- Same Stage 4 authority/receipt path; add the approved notification adapter.
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
    when serialization_failure or deadlock_detected or lock_not_available then raise;
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
