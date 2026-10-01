begin;
-- Infrastructure run metadata is platform-private. Tenants receive only
-- sanitized cadence availability, never platform work counts or run IDs.
create table private.automation_runs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('worker','discovery')),
 started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 outcome text not null default 'running' check(outcome in ('running','succeeded','degraded','failed')),
 metrics jsonb not null default '{}',
 check((outcome='running')=(completed_at is null))
);
create index automation_runs_latest on private.automation_runs(kind,started_at desc);
create index automation_runs_completed on private.automation_runs(kind,started_at desc) where completed_at is not null;
create index automation_runs_success on private.automation_runs(kind,completed_at desc) where outcome='succeeded';
alter table private.automation_runs enable row level security;
revoke all on private.automation_runs from public,anon,authenticated,service_role;
create function private.start_automation_run(kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if kind is null or kind not in ('worker','discovery') then raise exception 'Invalid run kind' using errcode='22023'; end if;
 insert into private.automation_runs(kind) values(kind) returning id into result;
 return result;
end $$;
create function private.finish_automation_run(run_id uuid,outcome text,metrics jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare entry record; run private.automation_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if outcome is null or outcome not in ('succeeded','degraded','failed') or jsonb_typeof(metrics) is distinct from 'object'
   or not private.automation_object(metrics,array['claimed','executions','failures','retried','deferred','acknowledged','rules','examined','emitted','duplicates']) then raise exception 'Invalid run result' using errcode='22023'; end if;
 for entry in select * from jsonb_each(metrics) loop
   if not private.automation_value_valid(entry.value,'{"kind":"number","integer":true,"min":0,"max":100000}') then raise exception 'Invalid run counts' using errcode='22023'; end if;
 end loop;
 select * into run from private.automation_runs r where r.id=run_id for update;
 if not found then return false; end if;
 if run.outcome<>'running' then return run.outcome=outcome and run.metrics=metrics; end if;
 update private.automation_runs r set outcome=$2,metrics=$3,completed_at=clock_timestamp() where r.id=run_id;
 return true;
end $$;
create function public.start_automation_run(kind text) returns uuid language sql security invoker set search_path='' as $$ select private.start_automation_run(kind); $$;
create function public.finish_automation_run(run_id uuid,outcome text,metrics jsonb) returns boolean language sql security invoker set search_path='' as $$ select private.finish_automation_run(run_id,outcome,metrics); $$;
revoke all on function private.start_automation_run(text),private.finish_automation_run(uuid,text,jsonb),public.start_automation_run(text),public.finish_automation_run(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.start_automation_run(text),private.finish_automation_run(uuid,text,jsonb),public.start_automation_run(text),public.finish_automation_run(uuid,text,jsonb) to service_role;

-- Observe an approaching window which discovery can no longer use. This receipt
-- creates no domain event, delivery or execution and never changes the deadline.
create table private.automation_missed_windows (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, rule_id uuid not null, rule_version bigint not null,
 entity_id uuid not null, episode text not null, threshold_at timestamptz not null, deadline_at timestamptz not null,
 observed_at timestamptz not null, check(observed_at>=deadline_at),
 unique(organization_id,rule_id,rule_version,entity_id,episode),
 foreign key(organization_id,rule_id,rule_version) references public.automation_rule_versions(organization_id,rule_id,version),
 foreign key(organization_id,entity_id) references public.tickets(organization_id,id)
);
alter table private.automation_missed_windows enable row level security;
revoke all on private.automation_missed_windows from public,anon,authenticated,service_role;
-- Each new index serves one bounded tenant/time or tenant/queue read below.
create index automation_missed_windows_recent on private.automation_missed_windows(organization_id,observed_at desc,id);
create index automation_occurrences_recent on private.automation_temporal_occurrences(organization_id,created_at desc,id);
create index automation_executions_recent on public.automation_executions(organization_id,started_at desc,id desc);
create index automation_deliveries_pending_org on private.domain_event_deliveries(organization_id,available_at,id) where status in ('pending','leased');
create index automation_deliveries_completed_org on private.domain_event_deliveries(organization_id,completed_at desc,id) where status in ('acknowledged','dead');

create function private.automation_heartbeat(kind text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'lastStartedAt',(select started_at from private.automation_runs r where r.kind=$1 order by started_at desc limit 1),
  'latestStartedAt',(select started_at from private.automation_runs r where r.kind=$1 order by started_at desc limit 1),
  'latestResult',(select outcome from private.automation_runs r where r.kind=$1 order by started_at desc limit 1),
  'lastCompletedAt',(select completed_at from private.automation_runs r where r.kind=$1 and completed_at is not null order by started_at desc limit 1),
  'latestCompletedResult',(select outcome from private.automation_runs r where r.kind=$1 and completed_at is not null order by started_at desc limit 1),
  'lastSuccessfulAt',(select completed_at from private.automation_runs r where r.kind=$1 and outcome='succeeded' order by completed_at desc limit 1));
$$;
create function private.require_automation_operations_admin(org uuid) returns void
language plpgsql stable set search_path='' as $$
begin
 if auth.uid() is null or not private.has_required_assurance() or not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) then raise exception 'Administrator and assurance required' using errcode='42501'; end if;
end $$;

create function private.read_automation_operations(org uuid) returns jsonb
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
   'retryScheduled',count(*) filter(where actionable and status='pending' and attempts>0 and available_at>stamp),
   'ineligiblePending',count(*) filter(where not actionable and status='pending'),
   'oldestEligibleAt',min(created_at) filter(where actionable and available_at<=stamp)) into queue from eligible;
 with candidates as materialized(select d.status,d.error_code,d.attempts from private.domain_event_deliveries d where d.organization_id=org and d.consumer='automation' and d.status in ('acknowledged','dead') and d.completed_at>=stamp-interval '24 hours' order by d.completed_at desc,d.id limit 1001), sample as(select * from candidates limit 1000)
 select jsonb_build_object('acknowledged',count(*) filter(where status='acknowledged'),'recovered',count(*) filter(where status='acknowledged' and attempts>1),'exhausted',count(*) filter(where error_code='retry_exhausted'),'failed',count(*) filter(where status='dead' and error_code is distinct from 'retry_exhausted'),'truncated',(select count(*)>1000 from candidates)) into recent from sample;
 queue:=queue||jsonb_build_object('recent',recent);
 with candidates as materialized(select status,error_code from public.automation_executions x where x.organization_id=org and x.started_at>=stamp-interval '24 hours' order by started_at desc,id desc limit 1001), sample as(select * from candidates limit 1000)
 select jsonb_build_object('total',count(*),'completed',count(*) filter(where status='succeeded'),'skipped',count(*) filter(where status='skipped'),'running',count(*) filter(where status='running'),
   'actionFailed',count(*) filter(where status in ('failed','partially_completed') and error_code is distinct from 'retry_exhausted' and error_code is distinct from 'delivery_failed'),
   'retryExhausted',count(*) filter(where error_code='retry_exhausted'),'deliveryFailed',count(*) filter(where error_code='delivery_failed'),'truncated',(select count(*)>1000 from candidates)) into executions from sample;
 with candidates as materialized(select o.* from private.automation_temporal_occurrences o where o.organization_id=org and o.created_at>=stamp-interval '24 hours' order by created_at desc,id limit 1001),
 sample as(select o.*,extract(epoch from e.occurred_at-o.threshold_at) seconds,e.occurred_at observed_at,e.after_snapshot#>>'{temporal,anchor}' deadline from candidates o join private.domain_events e on (e.organization_id,e.id)=(o.organization_id,o.event_id) order by o.created_at desc,o.id limit 1000)
 select jsonb_build_object('sampled',count(*),'truncated',(select count(*)>1000 from candidates),'maxSeconds',max(seconds),'latestSeconds',(array_agg(seconds order by created_at desc,id))[1],
 'withinWindow',count(*) filter(where trigger_type='ticket.sla_approaching' and seconds<=60 and observed_at<deadline::timestamptz),
 'lateBeforeDeadline',count(*) filter(where trigger_type='ticket.sla_approaching' and seconds>60 and observed_at<deadline::timestamptz)) into lag from sample;
 with candidates as materialized(select id from private.automation_missed_windows m where m.organization_id=org and m.observed_at>=stamp-interval '24 hours' order by observed_at desc,id limit 1001)
 select jsonb_build_object('missedWindow',least(count(*),1000),'missedTruncated',count(*)>1000) into missed from candidates;
 lag:=lag||missed;
 with candidates as materialized(select r.id,r.definition->>'name' name,r.version,r.trigger_type trigger,(r.definition#>>'{trigger,configuration,durationMinutes}')::integer duration,c.scanned_at
   from public.automation_rules r left join private.automation_temporal_cursors c on c.organization_id=r.organization_id and c.rule_id=r.id and c.rule_version=r.version
   where r.organization_id=org and r.enabled and r.archived_at is null and r.trigger_type in ('ticket.unassigned_duration_reached','ticket.waiting_on_user_duration_reached','ticket.open_duration_reached','ticket.sla_approaching','ticket.sla_breached')
   order by r.created_at,r.id limit 51), sample as(select * from candidates limit 50)
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'trigger',trigger,'durationMinutes',duration,'lastScannedAt',scanned_at,
 'atRisk',trigger='ticket.sla_approaching' and (scanned_at is null or extract(epoch from stamp-scanned_at)>=duration*60 or coalesce((lag->>'maxSeconds')::numeric,0)>=duration*60))), '[]'),'truncated',(select count(*)>50 from candidates)) into rules from sample;
 return jsonb_build_object('now',stamp,'processingActive',(select active from private.automation_processing_state),'worker',private.automation_heartbeat('worker'),'discovery',private.automation_heartbeat('discovery'),
  'queue',queue,'executions',executions,'lag',lag,'temporalRules',rules->'rows','temporalRulesTruncated',rules->'truncated');
end $$;
create function public.read_automation_operations(org uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.read_automation_operations(org); $$;

create function private.read_automation_operations_history(org uuid,query text,trigger_type text,result_filter text,since_at timestamptz,until_at timestamptz,before_at timestamptz,before_id uuid,ticket_number bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare stamp timestamptz:=statement_timestamp(); start_at timestamptz:=coalesce(since_at,stamp-interval '24 hours'); end_at timestamptz:=coalesce(until_at,stamp); result jsonb;
begin
 perform private.require_automation_operations_admin(org);
 if query is null or char_length(query)>120 or trigger_type is null or char_length(trigger_type)>100 or result_filter is null or result_filter not in ('all','succeeded','skipped','running','action_failed','retry_exhausted','delivery_failed','failures')
  or start_at>=end_at or end_at-start_at>interval '31 days' or (before_at is null)<>(before_id is null) or ticket_number<1 then raise exception 'Invalid history filters' using errcode='22023'; end if;
 with candidates as materialized(
  select x.id,x.rule_id,x.rule_version,x.rule_name,x.trigger_type,x.entity_id,x.started_at,x.status,x.error_code,x.duration_ms,t.ticket_number
  from public.automation_executions x left join public.tickets t on t.organization_id=x.organization_id and t.id=x.entity_id
  where x.organization_id=org and x.started_at>=start_at and x.started_at<end_at
    and (query='' or strpos(lower(x.rule_name),lower(query))>0) and (trigger_type='' or x.trigger_type=read_automation_operations_history.trigger_type)
    and (read_automation_operations_history.ticket_number is null or t.ticket_number=read_automation_operations_history.ticket_number)
    and (before_at is null or (x.started_at,x.id)<(before_at,before_id))
    and case result_filter when 'all' then true when 'failures' then x.status in ('failed','partially_completed')
      when 'action_failed' then x.status in ('failed','partially_completed') and x.error_code is distinct from 'retry_exhausted' and x.error_code is distinct from 'delivery_failed'
      when 'retry_exhausted' then x.error_code='retry_exhausted' when 'delivery_failed' then x.error_code='delivery_failed' else x.status=result_filter end
  order by x.started_at desc,x.id desc limit 51),
 page as(select * from candidates order by started_at desc,id desc limit 50),
 rows as(select p.*, (select count(*) from public.automation_execution_steps s where s.organization_id=org and s.execution_id=p.id and s.status='succeeded') completed_actions,
  (select count(*) from public.automation_execution_steps s where s.organization_id=org and s.execution_id=p.id) total_actions from page p)
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(rows) order by started_at desc,id desc),'[]'),'hasNext',(select count(*)>50 from candidates),'since',start_at,'until',end_at) into result from rows;
 return result;
end $$;
create function public.read_automation_operations_history(org uuid,query text default '',trigger_type text default '',result_filter text default 'all',since_at timestamptz default null,until_at timestamptz default null,before_at timestamptz default null,before_id uuid default null,ticket_number bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.read_automation_operations_history(org,query,trigger_type,result_filter,since_at,until_at,before_at,before_id,ticket_number); $$;
revoke all on function private.automation_heartbeat(text),private.require_automation_operations_admin(uuid),private.read_automation_operations(uuid),public.read_automation_operations(uuid),private.read_automation_operations_history(uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,bigint),public.read_automation_operations_history(uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.read_automation_operations(uuid),public.read_automation_operations(uuid),private.read_automation_operations_history(uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,bigint),public.read_automation_operations_history(uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,bigint) to authenticated;

-- Existing discovery semantics are unchanged; record the already skipped case.
create or replace function private.discover_temporal_automation(rule_limit integer,ticket_limit integer) returns jsonb
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

commit;
