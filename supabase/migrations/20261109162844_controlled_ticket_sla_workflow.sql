-- Apply before the application release. Existing outcomes and holds are not backdated.
alter table public.tickets
  add column acknowledged_at timestamptz,
  add column first_response_kind text check(first_response_kind in ('public_reply','work_started')),
  add column hold_reason text check (hold_reason in ('vendor','parts','approval','scheduled_work')),
  add column hold_note text check (char_length(btrim(hold_note)) between 1 and 2000),
  add column hold_review_at timestamptz,
  add column hold_elapsed_seconds double precision not null default 0;
grant update(hold_reason,hold_note,hold_review_at) on public.tickets to authenticated;
revoke insert(acknowledged_at,first_response_kind,hold_elapsed_seconds), update(acknowledged_at,first_response_kind,hold_elapsed_seconds) on public.tickets from anon,authenticated;
create index tickets_hold_review_idx on public.tickets(organization_id,hold_review_at,id) where status='on_hold';

alter table public.tickets drop constraint ticket_sla_pause_state;
alter table public.tickets add constraint ticket_sla_pause_state check (
  (resolution_sla_paused_at is null and resolution_sla_remaining_seconds is null and resolution_sla_due_at is not null)
  or (status in ('waiting_on_user','on_hold') and resolution_sla_paused_at is not null and resolution_sla_remaining_seconds is not null)
);

-- Runs before revision and SLA preparation. Client-supplied clock values are ignored.
create function private.prepare_ticket_hold() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
 if tg_op='INSERT' then
   new.acknowledged_at:=null; new.first_response_kind:=null; new.hold_elapsed_seconds:=0;
 else
   new.acknowledged_at:=old.acknowledged_at;
   new.first_response_kind:=old.first_response_kind;
   if old.first_response_at is null and new.first_response_at is not null then new.first_response_kind:='public_reply'; end if;
   new.hold_elapsed_seconds:=old.hold_elapsed_seconds;
   if old.resolution_sla_paused_at is not null and new.status not in ('on_hold','waiting_on_user') then
     new.hold_elapsed_seconds:=old.hold_elapsed_seconds+greatest(0,extract(epoch from now()-old.resolution_sla_paused_at));
   end if;
   if new.acknowledged_at is null and (
      (new.status='in_progress' and old.status is distinct from new.status and private.can_work_tickets(new.organization_id))
      or (old.first_response_at is null and new.first_response_at is not null)) then
     new.acknowledged_at:=now();
   end if;
   -- A technician handling their own request explicitly acknowledges it by starting work.
   if new.status='in_progress' and old.status is distinct from new.status
      and new.requester_id=auth.uid() and new.assigned_technician_id=auth.uid()
      and private.can_work_tickets(new.organization_id) and old.first_response_at is null then
     new.first_response_at:=now(); new.first_response_kind:='work_started';
   end if;
 end if;
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then
   changed:=old.status<>'on_hold' or (old.assigned_technician_id is distinct from new.assigned_technician_id and new.assigned_technician_id is null) or row(old.hold_reason,old.hold_note,old.hold_review_at) is distinct from row(new.hold_reason,new.hold_note,new.hold_review_at);
 end if;
 if new.status='on_hold' and changed then
   if new.assigned_technician_id is null or new.hold_reason is null or new.hold_note is null
     or char_length(btrim(new.hold_note)) not between 1 and 2000
     or new.hold_review_at is null or new.hold_review_at<=now() then
     raise exception 'On hold requires an owner, reason, explanation and future follow-up date' using errcode='22023';
   end if;
 end if;
 if new.status<>'on_hold' then
   new.hold_reason:=null; new.hold_note:=null; new.hold_review_at:=null;
 end if;
 return new;
end $$;
revoke all on function private.prepare_ticket_hold() from public,anon,authenticated;
create trigger tickets_prepare_hold before insert or update on public.tickets for each row execute function private.prepare_ticket_hold();

create or replace function private.prepare_ticket_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.revision:=1;
  elsif row(new.title,new.description,new.requester_id,new.assigned_technician_id,new.team_id,new.category_id,new.subcategory_id,new.priority,new.status,new.location_id,new.due_at,new.first_response_at,new.resolved_at,new.closed_at,new.response_sla_due_at,new.resolution_sla_due_at,new.routing_mode,new.ticket_type,new.incident_revision,new.hold_reason,new.hold_note,new.hold_review_at,new.acknowledged_at)
    is distinct from row(old.title,old.description,old.requester_id,old.assigned_technician_id,old.team_id,old.category_id,old.subcategory_id,old.priority,old.status,old.location_id,old.due_at,old.first_response_at,old.resolved_at,old.closed_at,old.response_sla_due_at,old.resolution_sla_due_at,old.routing_mode,old.ticket_type,old.incident_revision,old.hold_reason,old.hold_note,old.hold_review_at,old.acknowledged_at)
  then new.revision:=old.revision+1;
  else new.revision:=old.revision; end if;
  return new;
end $$;

create or replace function private.prepare_ticket_sla()
returns trigger language plpgsql security definer set search_path='' as $$
declare budget double precision; due timestamptz; at_time timestamptz:=now();
begin
  if tg_op='INSERT' then
    select targets,schedule into new.sla_targets,new.sla_schedule from private.organization_sla_policies where organization_id=new.organization_id;
    new.sla_targets:=coalesce(new.sla_targets,private.default_sla_targets());
    new.sla_schedule:=coalesce(new.sla_schedule,private.default_sla_schedule());
    select timezone into new.sla_timezone from public.organizations where id=new.organization_id;
    new.resolution_sla_paused_at:=null;
    new.resolution_sla_remaining_seconds:=null;
    new.sla_paused_business_seconds:=0;
    if new.status in ('resolved','closed') then new.resolved_at:=coalesce(new.resolved_at,new.created_at); end if;
    if new.status='closed' then new.closed_at:=coalesce(new.closed_at,new.created_at); end if;
    new.response_sla_due_at:=private.sla_add_business_seconds(new.created_at,(new.sla_targets->new.priority::text->>'response')::integer*60.0,new.sla_timezone,new.sla_schedule);
    new.resolution_sla_due_at:=private.sla_add_business_seconds(new.created_at,(new.sla_targets->new.priority::text->>'resolution')::integer*60.0,new.sla_timezone,new.sla_schedule);
  else
    new.sla_targets:=coalesce(old.sla_targets,private.default_sla_targets());
    new.sla_schedule:=coalesce(old.sla_schedule,private.default_sla_schedule());
    -- Never accept client-supplied timing state, including from privileged callers.
    new.sla_timezone:=old.sla_timezone;
    new.resolution_sla_paused_at:=old.resolution_sla_paused_at;
    new.resolution_sla_remaining_seconds:=old.resolution_sla_remaining_seconds;
    new.sla_paused_business_seconds:=old.sla_paused_business_seconds;
    new.response_sla_due_at:=old.response_sla_due_at;
    new.resolution_sla_due_at:=old.resolution_sla_due_at;
    -- Completed calendar-policy history is immutable until explicitly reopened.
    if new.sla_timezone is null and new.status not in ('resolved','closed') then
      select timezone into new.sla_timezone from public.organizations where id=new.organization_id;
    end if;
    if new.sla_timezone is null then return new; end if;
    if old.resolution_sla_paused_at is not null and new.status not in ('waiting_on_user','on_hold') then
      new.sla_paused_business_seconds:=old.sla_paused_business_seconds+
        greatest(0,private.sla_business_seconds(old.resolution_sla_paused_at,at_time,new.sla_timezone,new.sla_schedule));
      new.resolution_sla_paused_at:=null;
      new.resolution_sla_remaining_seconds:=null;
    end if;
    if old.priority is distinct from new.priority and old.status not in ('resolved','closed') and old.first_response_at is null then
      new.response_sla_due_at:=private.sla_add_business_seconds(old.created_at,(new.sla_targets->new.priority::text->>'response')::integer*60.0,new.sla_timezone,new.sla_schedule);
    end if;
    if old.resolution_sla_paused_at is not null and new.status not in ('waiting_on_user','on_hold')
      or (old.priority is distinct from new.priority and old.status not in ('resolved','closed'))
      or (old.sla_timezone is null and new.status not in ('resolved','closed')) then
      budget:=(new.sla_targets->new.priority::text->>'resolution')::integer*60.0;
      new.resolution_sla_due_at:=private.sla_add_business_seconds(new.created_at,budget+new.sla_paused_business_seconds,new.sla_timezone,new.sla_schedule);
    end if;
  end if;
  if (new.status='waiting_on_user' or (new.status='on_hold' and new.hold_reason is not null and new.hold_note is not null and new.hold_review_at is not null)) and (tg_op='INSERT' or old.resolution_sla_paused_at is null or old.priority is distinct from new.priority) then
    new.resolution_sla_paused_at:=coalesce(new.resolution_sla_paused_at,at_time);
    new.resolution_sla_remaining_seconds:=private.sla_business_seconds(new.resolution_sla_paused_at,new.resolution_sla_due_at,new.sla_timezone,new.sla_schedule);
    -- A breach that happened before waiting stays visible and cannot be erased.
    if new.resolution_sla_remaining_seconds>0 then new.resolution_sla_due_at:=null; end if;
  end if;
  return new;
end $$;
revoke all on function private.prepare_ticket_sla() from public,anon,authenticated;


-- Capture hold details independently of status/priority events, including review rescheduling.
create function private.record_ticket_hold() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='on_hold' and (new.status<>'on_hold' or old.hold_review_at is distinct from new.hold_review_at or old.assigned_technician_id is distinct from new.assigned_technician_id) then
   update private.notification_email_outbox q set status='skipped',last_error='Hold reviewed, resumed or reassigned'
   from public.notifications n where n.id=q.notification_id and n.ticket_id=new.id
     and n.kind='hold_review_due' and q.status='pending';
 end if;
 if row(new.hold_reason,new.hold_note,new.hold_review_at) is distinct from row(old.hold_reason,old.hold_note,old.hold_review_at) then
   insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details)
   values(new.organization_id,new.id,auth.uid(),case when new.status='on_hold' then 'hold_review_updated' else 'hold_ended' end,
    jsonb_build_object('reason',coalesce(new.hold_note,old.hold_note),'hold_reason',coalesce(new.hold_reason,old.hold_reason),'review_at',coalesce(new.hold_review_at,old.hold_review_at)));
 end if;
 if old.acknowledged_at is null and new.acknowledged_at is not null then
   insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details)
   values(new.organization_id,new.id,auth.uid(),'acknowledged','{}');
 end if;
 return new;
end $$;
revoke all on function private.record_ticket_hold() from public,anon,authenticated;
create trigger tickets_record_hold after update on public.tickets for each row execute function private.record_ticket_hold();

-- Existing notification channel; distinct title and dedupe per review date and owner.
create function public.enqueue_hold_review_notifications() returns integer language plpgsql security definer set search_path='' as $$
declare ticket record; worker record; total integer:=0;
begin
 for ticket in select * from public.tickets where status='on_hold' and (hold_review_at<=now() or hold_review_at is null) loop
   for worker in select user_id from public.organization_memberships where organization_id=ticket.organization_id
     and status='active' and role in ('technician','administrator')
     and (user_id=ticket.assigned_technician_id or ticket.assigned_technician_id is null) loop
     perform private.enqueue_notification(ticket.organization_id,worker.user_id,null,ticket.id,null,'hold_review_due',
       'Ticket #'||ticket.ticket_number||' hold follow-up overdue',true,
       'hold-review:'||ticket.id||':'||coalesce(ticket.hold_review_at::text,'missing')||':'||worker.user_id);
     total:=total+1;
   end loop;
 end loop;
 return total;
end $$;
revoke all on function public.enqueue_hold_review_notifications() from public,anon,authenticated;
grant execute on function public.enqueue_hold_review_notifications() to service_role;


-- Pure calculation reads no tables; allow staff report callers to execute it.
grant execute on function private.sla_business_seconds(timestamptz,timestamptz,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.operational_report (
  target_organization_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  report_now timestamptz := now();
  today date;
  report_timezone text;
  result jsonb;
begin
  if not exists (select 1 from public.organization_memberships m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('administrator', 'technician')) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  select timezone into strict report_timezone from public.organizations where id = target_organization_id;
  today := (report_now at time zone report_timezone)::date;
  with base as materialized (
    select t.*, (t.created_at at time zone report_timezone)::date as created_day,
      (t.first_response_at at time zone report_timezone)::date as response_day,
      (t.resolved_at at time zone report_timezone)::date as resolved_day,
      t.status not in ('resolved','closed') as active,
      extract(epoch from (t.first_response_at-t.created_at))/60 as response_minutes,
      extract(epoch from (t.resolved_at-t.created_at))/60 as resolution_minutes,
      coalesce(c.name,'Uncategorized') as category_name,
      coalesce(p.display_name,'Unassigned') as technician_name,
      coalesce(d.name,'No department') as department_name,
      coalesce(l.path,'No location') as location_name
    from public.tickets t
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.profiles p on p.organization_id=t.organization_id and p.user_id=t.assigned_technician_id
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.location_paths l on l.organization_id=t.organization_id and l.id=t.location_id
    where t.organization_id=target_organization_id and t.created_at <= report_now
  ), events as materialized (
    select a.ticket_id, (a.created_at at time zone report_timezone)::date as day,
      a.details->>'from' in ('resolved','closed') and a.details->>'to' not in ('resolved','closed') as reopened,
      a.details->>'from' not in ('resolved','closed') and a.details->>'to' in ('resolved','closed') as resolved
    from public.ticket_activity a
    where a.organization_id=target_organization_id and a.action='status_changed'
      and a.created_at >= ((today-29)::timestamp at time zone report_timezone) and a.created_at <= report_now
  ), days as (select today - i as day from generate_series(0,29) i), daily as (
    select day,
      (select count(*) from base where created_day=days.day) as created,
      (select count(distinct ticket_id) from events where events.day=days.day and resolved) as resolved,
      (select count(distinct ticket_id) from events where events.day=days.day and reopened) as reopened,
      (select avg(response_minutes) from base where response_day=days.day and response_minutes>=0) as response,
      (select avg(resolution_minutes) from base where resolved_day=days.day and resolution_minutes>=0) as resolution
    from days
  ), objectives as (
    select 'Response' as label, first_response_at <= response_sla_due_at as met from base
    where response_day>=today-29 and first_response_at<=report_now and response_sla_due_at is not null
    union all
    select 'Resolution', resolved_at <= resolution_sla_due_at from base
    where resolved_day>=today-29 and resolved_at<=report_now and resolution_sla_due_at is not null
  ), breakdowns as (
    select 'categories' as kind, category_name as label, count(*) as value from base where created_day>=today-29 group by category_id,category_name
    union all select 'workload',technician_name,count(*) from base where active group by assigned_technician_id,technician_name
    union all select 'departments',department_name,count(*) from base where created_day>=today-29 group by department_name
    union all select 'locations',location_name,count(*) from base where created_day>=today-29 group by location_id,location_name
    union all select 'backlog',case when report_now-created_at<interval '1 day' then 'Under 1 day' when report_now-created_at<interval '7 days' then '1–6 days' when report_now-created_at<interval '30 days' then '7–29 days' else '30+ days' end,count(*) from base where active group by 2
  )
  select jsonb_build_object(
    'lifecycle',jsonb_build_object(
      'acknowledgment',(select avg(extract(epoch from(acknowledged_at-created_at))/60) from base where acknowledged_at>=((today-29)::timestamp at time zone report_timezone) and acknowledged_at<=report_now),
      'acknowledgmentSamples',(select count(*) from base where acknowledged_at>=((today-29)::timestamp at time zone report_timezone) and acknowledged_at<=report_now),
      'holdReviewsDue',(select count(*) from base where status='on_hold' and (hold_review_at is null or hold_review_at<=report_now)),
      'heldTickets',(select count(*) from base where status='on_hold'),
      'resolutionSupport',(select avg(greatest(0,private.sla_business_seconds(created_at,resolved_at,sla_timezone,sla_schedule)-sla_paused_business_seconds)/60) from base where resolved_day>=today-29 and resolved_at<=report_now and sla_timezone is not null),
      'resolutionSupportSamples',(select count(*) from base where resolved_day>=today-29 and resolved_at<=report_now and sla_timezone is not null),
      'resolutionElapsed',(select avg(resolution_minutes) from base where resolved_day>=today-29 and resolved_at<=report_now),
      'holdElapsed',(select avg(hold_elapsed_seconds/60) from base where resolved_day>=today-29 and resolved_at<=report_now)),
    'asOf',report_now,'timezone',report_timezone,'today',today,
    'summary',jsonb_build_object(
      'created',(select count(*) from base where created_day=today),
      'resolved',(select count(distinct ticket_id) from events where day=today and resolved),
      'open',(select count(*) from base where active),
      'overdue',(select count(*) from base where active and sla_next_due_at<=report_now),
      'response',(select avg(response_minutes) from base where response_day=today and response_minutes>=0),
      'resolution',(select avg(resolution_minutes) from base where resolved_day=today and resolution_minutes>=0)),
    'daily',(select jsonb_agg(to_jsonb(daily) order by day) from daily),
    'breakdowns',coalesce((select jsonb_agg(to_jsonb(breakdowns) order by kind,value desc,label) from breakdowns),'[]'::jsonb),
    'sla',coalesce((select jsonb_agg(s) from (select label,count(*) as total,count(*) filter(where met) as met from objectives group by label order by label) s),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

-- Automatic status actions cannot provide an individually reviewed hold and date.
-- Keep status conditions/triggers complete while restricting only the write action.
alter function private.automation_definition_catalog() rename to automation_definition_catalog_before_controlled_holds;
create function private.automation_definition_catalog() returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_set(c,'{actions,set_status,configuration,status,value,values}',
   (c#>'{actions,set_status,configuration,status,value,values}')-'on_hold')
 from (select private.automation_definition_catalog_before_controlled_holds() c) catalog;
$$;
revoke all on function private.automation_definition_catalog() from public,anon,authenticated,service_role;
