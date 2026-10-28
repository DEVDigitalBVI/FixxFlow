begin;
-- Additive registry extension; existing triggers, validation and runtime stay in force.
alter function private.automation_definition_catalog() rename to automation_definition_catalog_before_intake;
create function private.automation_definition_catalog() returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_set(jsonb_set(c,'{triggers}',c->'triggers'||'{"ticket.created_from_email":{"entityType":"ticket","configuration":{}},"ticket.created_from_chat":{"entityType":"ticket","configuration":{}}}'::jsonb),
 '{actions}',c->'actions'||'{"suggest_articles":{"entityType":"ticket","configuration":{},"triggerTypes":["ticket.created","ticket.created_from_email","ticket.created_from_chat"]}}'::jsonb)
 from (select private.automation_definition_catalog_before_intake() c) q;
$$;
revoke all on function private.automation_definition_catalog() from public,anon,authenticated,service_role;

-- Source is recorded only by trusted intake operations, never a client-supplied field.
create table private.ticket_intake_origins (
 organization_id uuid not null, ticket_id uuid primary key, channel text not null check(channel in ('email','chat')),
 created_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
alter table private.ticket_intake_origins enable row level security;
revoke all on private.ticket_intake_origins from public,anon,authenticated,service_role;
create function private.record_ticket_intake(org uuid,target uuid,source text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tickets; snapshot jsonb;
begin
 select * into strict t from public.tickets where organization_id=org and id=target for update;
 insert into private.ticket_intake_origins values(org,target,source,now()) on conflict do nothing;
 if not found then return; end if;
 snapshot:=private.ticket_event_snapshot(t);
 perform private.publish_domain_event(org,'ticket.created_from_'||source,'ticket',target,t.revision,null,snapshot,array[]::text[],gen_random_uuid());
end $$;
revoke all on function private.record_ticket_intake(uuid,uuid,text) from public,anon,authenticated,service_role;
create function private.capture_email_ticket_intake() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='ticket_created' and new.ticket_id is not null then
   perform private.record_ticket_intake(new.organization_id,new.ticket_id,'email');
 end if;
 return new;
end $$;
revoke all on function private.capture_email_ticket_intake() from public,anon,authenticated,service_role;
create trigger inbound_email_intake after insert on public.inbound_emails for each row execute function private.capture_email_ticket_intake();

-- Privileged publisher stays private; explicit live tenant/role/MFA guards protect
-- the conversion before bypassing RLS. Linking an existing ticket never calls it.
create function private.convert_chat_with_intake(conversation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.chat_conversations; target uuid; first_message text;
begin
 select * into c from public.chat_conversations where id=conversation_id for update;
 if not found or auth.uid() is null or private.has_required_assurance() is not true or private.can_work_tickets(c.organization_id) is not true then
   raise exception 'Chat not found or access denied' using errcode='42501'; end if;
 if c.ticket_id is not null then return c.ticket_id; end if;
 select body into first_message from public.chat_messages where organization_id=c.organization_id and chat_messages.conversation_id=c.id and kind='message' order by created_at,id limit 1;
 insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description,status)
 values(c.organization_id,c.requester_id,c.assigned_technician_id,c.topic,coalesce(first_message,'Support chat converted to a ticket.'),'open') returning id into target;
 perform set_config('app.converted_ticket',target::text,true);
 update public.chat_conversations set ticket_id=target where id=c.id;
 perform set_config('app.converted_ticket','',true);
 perform private.record_ticket_intake(c.organization_id,target,'chat');
 return target;
end $$;
revoke all on function private.convert_chat_with_intake(uuid) from public,anon,authenticated,service_role;
grant execute on function private.convert_chat_with_intake(uuid) to authenticated;
create or replace function public.convert_chat_to_ticket(conversation_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select private.convert_chat_with_intake(conversation_id); $$;

alter function private.automation_ticket_event_compatible(private.domain_events) rename to automation_ticket_event_compatible_before_intake;
create function private.automation_ticket_event_compatible(event private.domain_events) returns boolean
language plpgsql stable set search_path='' as $$
declare field text;
begin
 if event.event_type not in ('ticket.created_from_email','ticket.created_from_chat') then return private.automation_ticket_event_compatible_before_intake(event); end if;
 if event.entity_type<>'ticket' or event.schema_version<>1 or event.before_snapshot is not null or event.temporal_occurrence_id is not null then return false; end if;
 foreach field in array array['status','priority','requester_id'] loop
   if not private.automation_snapshot_value_valid('ticket',field,event.after_snapshot->field) then return false; end if;
 end loop;
 return exists(select 1 from private.ticket_intake_origins i where i.organization_id=event.organization_id and i.ticket_id=event.entity_id and event.event_type='ticket.created_from_'||i.channel);
end $$;
revoke all on function private.automation_ticket_event_compatible(private.domain_events) from public,anon,authenticated,service_role;

alter table public.automation_execution_steps drop constraint automation_execution_steps_result_check;
alter table public.automation_execution_steps add constraint automation_execution_steps_result_check check(result is null or (private.automation_object(result,array['code','entityType','entityId']) and (result->>'code'='completed' or (action_type='suggest_articles' and result->>'code'='no_article_reply' and result->'entityId'='null'::jsonb))));

-- The existing receipt still enforces one message per step. This second ledger
-- prevents duplicate public replies from different rules or creation events.
create table private.ticket_article_replies (
 organization_id uuid not null,ticket_id uuid primary key,message_id uuid not null,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(message_id) references public.ticket_messages(id)
);
create index ticket_article_reply_message_fk on private.ticket_article_replies(message_id);
alter table private.ticket_article_replies enable row level security;
revoke all on private.ticket_article_replies from public,anon,authenticated,service_role;
alter table public.ticket_messages drop constraint ticket_message_authorship;
alter table public.ticket_messages add constraint ticket_message_authorship check(
 (author_type='member' and author_id is not null and automation_execution_id is null and automation_step_id is null and automation_name is null)
 or (author_type='automation' and author_id is null and kind in ('internal_note','reply') and automation_execution_id is not null and automation_step_id is not null and automation_name is not null)
);
create or replace function private.guard_automation_note() returns trigger language plpgsql security definer set search_path to '' as $function$
declare execution public.automation_executions; context private.automation_command_contexts;
begin
  if tg_op<>'INSERT' and old.author_type='automation' then
    raise exception 'Automation note receipt is immutable' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  if current_setting('role',true)='service_role' and new.author_type<>'automation'
    and not exists(select 1 from private.inbound_message_contexts c where c.transaction_id=pg_current_xact_id()
      and c.organization_id=new.organization_id and c.ticket_id=new.ticket_id and c.author_id=new.author_id) then
    raise exception 'Validated automation note required' using errcode='42501';
  end if;
  if new.author_type='automation' then
    execution:=private.current_automation_command(new.organization_id,new.ticket_id);
    select * into context from private.automation_command_contexts where transaction_id=pg_current_xact_id();
    if execution.id is null or new.automation_execution_id is distinct from execution.id or new.automation_step_id is distinct from context.step_id
      or not exists(select 1 from public.automation_execution_steps where id=context.step_id and ((action_type='add_internal_note' and new.kind='internal_note' and new.automation_name=execution.rule_name) or (action_type='suggest_articles' and new.kind='reply' and new.automation_name='Article suggestions'))) then
      raise exception 'Invalid automation note authority' using errcode='42501';
    end if;
  end if;
  return new;
end $function$;


create function private.reply_with_suggested_articles() returns uuid
language plpgsql security definer set search_path='' as $$
declare context private.automation_command_contexts; execution public.automation_executions; t public.tickets;
 terms tsquery; guide record; content text:='You may find these guides helpful:'; result uuid; count_guides integer:=0;
begin
 select * into strict context from private.automation_command_contexts where transaction_id=pg_current_xact_id();
 select * into strict execution from public.automation_executions where id=context.execution_id;
 if private.current_automation_command(execution.organization_id,execution.entity_id) is null
   or execution.trigger_type not in ('ticket.created','ticket.created_from_email','ticket.created_from_chat')
   or not exists(select 1 from public.automation_execution_steps where id=context.step_id and action_type='suggest_articles') then raise exception 'Invalid article reply authority' using errcode='42501'; end if;
 select * into strict t from public.tickets where organization_id=execution.organization_id and id=execution.entity_id for update;
 if t.status in ('resolved','closed') or t.first_response_at is not null
   or exists(select 1 from private.ticket_article_replies r where r.ticket_id=t.id)
   or not exists(select 1 from public.organization_memberships m where m.organization_id=t.organization_id and m.user_id=t.requester_id and m.status='active') then return null; end if;
 terms:=replace(plainto_tsquery('english',regexp_replace(lower(t.title),'wi[ -]?fi','wifi','g'))::text,' & ',' | ')::tsquery;
 -- Deliberately explicit audience and tenant checks: a worker's service identity
 -- must never stand in for the employee's visibility or reveal hidden library guides.
 for guide in
   with visible as (
     select a.id,a.title,a.summary from public.knowledge_articles a where a.organization_id=t.organization_id and a.status='published' and a.audience='employees'
     union all
     select a.id,a.title,a.summary from public.library_articles a where a.status='published' and a.audience='employees'
       and not exists(select 1 from public.hidden_library_articles h where h.organization_id=t.organization_id and h.article_id=a.id)
   ) select a.id,a.title from visible a where private.article_suggestion_vector(a.title,a.summary) @@ terms
     order by ts_rank_cd(private.article_suggestion_vector(a.title,a.summary),terms) desc,a.title,a.id limit 3
 loop
   count_guides:=count_guides+1;
   content:=content||E'\n\n'||regexp_replace(guide.title,E'[\r\n\t]+',' ','g')||E'\nhttps://fixxflow.com/app/help/'||guide.id::text;
 end loop;
 if count_guides=0 then return null; end if;
 content:=content||E'\n\nIf these don’t help, reply here and IT will follow up.';
 insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body,author_type,automation_execution_id,automation_step_id,automation_name)
 values(t.organization_id,t.id,null,'reply',content,'automation',execution.id,context.step_id,'Article suggestions') returning id into result;
 insert into private.ticket_article_replies values(t.organization_id,t.id,result);
 return result;
end $$;
revoke all on function private.reply_with_suggested_articles() from public,anon,authenticated,service_role;
create or replace function private.execute_automation_ticket_step(execution_id uuid,token uuid,command jsonb)
returns public.automation_execution_steps language plpgsql security definer set search_path='' as $$
declare execution public.automation_executions%rowtype; step public.automation_execution_steps%rowtype;
  delivery private.domain_event_deliveries%rowtype; event private.domain_events%rowtype;
  rule public.automation_rules%rowtype; version public.automation_rule_versions%rowtype;
  processing private.automation_processing_state%rowtype; ticket public.tickets%rowtype;
  action jsonb; config jsonb; reference record; failure text; result_id uuid; result_type text:='ticket'; result_code text:='completed';
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
        when 'suggest_articles' then
          result_id:=private.reply_with_suggested_articles(); result_type:='ticket_message';
          if result_id is null then result_code:='no_article_reply'; end if;
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
      update public.automation_execution_steps s set status='succeeded',completed_at=clock_timestamp(),result=jsonb_build_object('code',result_code,'entityType',result_type,'entityId',result_id) where s.id=step.id returning * into step;
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


-- Public activity must not expose private routing-rule names. Audit records retain them.
create or replace function private.stamp_automation_provenance() returns trigger
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
      new.actor_id:=null; new.details:=new.details||jsonb_build_object('automationExecutionId',execution.id,'automationName',case when exists(select 1 from private.automation_command_contexts c join public.automation_execution_steps a on a.id=c.step_id where c.transaction_id=pg_current_xact_id() and a.action_type='suggest_articles') then 'Article suggestions' else execution.rule_name end);
    else new.actor_id:=null; new.actor_name:='Automation: '||execution.rule_name;
    end if;
  elsif tg_table_name='domain_events' then
    if new.actor_type='automation' or new.automation_execution_id is not null then raise exception 'Invalid automation event authority' using errcode='42501'; end if;
  end if;
  return new;
end $$;

commit;
