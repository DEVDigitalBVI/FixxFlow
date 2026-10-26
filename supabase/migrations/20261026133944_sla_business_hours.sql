begin;

-- The schedule is 07:00–22:00 every day. Keep each ticket's support timezone
-- stable if the workspace later changes its timezone. NULL identifies history
-- completed under the previous calendar-hours policy.
alter table public.tickets
  add column sla_timezone text,
  add column resolution_sla_paused_at timestamptz,
  add column resolution_sla_remaining_seconds double precision,
  add column sla_paused_business_seconds double precision not null default 0
    check (sla_paused_business_seconds >= 0),
  alter column resolution_sla_due_at drop not null;
revoke insert(sla_timezone,resolution_sla_paused_at,resolution_sla_remaining_seconds,sla_paused_business_seconds),
  update(sla_timezone,resolution_sla_paused_at,resolution_sla_remaining_seconds,sla_paused_business_seconds)
  on public.tickets from anon,authenticated;

create function private.sla_business_seconds(start_at timestamptz, end_at timestamptz, zone text)
returns double precision language sql stable set search_path='' as $$
  select case when end_at < start_at then -private.sla_business_seconds(end_at,start_at,zone)
  else coalesce(sum(greatest(0,extract(epoch from (
    least(end_at,(day::date+time '22:00') at time zone zone)
    - greatest(start_at,(day::date+time '07:00') at time zone zone)
  )))),0)::double precision end
  from generate_series((least(start_at,end_at) at time zone zone)::date::timestamp,
    (greatest(start_at,end_at) at time zone zone)::date::timestamp,interval '1 day') day;
$$;
revoke all on function private.sla_business_seconds(timestamptz,timestamptz,text) from public,anon,authenticated;

create function private.sla_add_business_seconds(start_at timestamptz, seconds double precision, zone text)
returns timestamptz language plpgsql stable set search_path='' as $$
declare cursor_at timestamptz:=start_at; remaining double precision:=seconds;
  day date; opens timestamptz; closes timestamptz; available double precision;
begin
  if seconds < 0 or not isfinite(start_at) then raise exception 'Invalid SLA duration'; end if;
  loop
    day:=(cursor_at at time zone zone)::date;
    opens:=(day+time '07:00') at time zone zone;
    closes:=(day+time '22:00') at time zone zone;
    cursor_at:=greatest(cursor_at,opens);
    available:=greatest(0,extract(epoch from closes-cursor_at));
    if remaining<=available and cursor_at<=closes then
      return cursor_at+make_interval(secs=>remaining);
    end if;
    remaining:=remaining-available;
    cursor_at:=((day+1)+time '07:00') at time zone zone;
  end loop;
end $$;
revoke all on function private.sla_add_business_seconds(timestamptz,double precision,text) from public,anon,authenticated;

-- Retain the old three-argument function for calendar-policy history and derive
-- unchanged priority budgets from it. All new deadlines use this overload.
create function private.ticket_sla_deadline(start_at timestamptz, priority public.ticket_priority, response boolean, zone text)
returns timestamptz language sql stable set search_path='' as $$
  select private.sla_add_business_seconds(start_at,
    extract(epoch from private.ticket_sla_deadline(start_at,priority,response)-start_at)::double precision,zone);
$$;
revoke all on function private.ticket_sla_deadline(timestamptz,public.ticket_priority,boolean,text) from public,anon,authenticated;

create or replace function private.prepare_ticket_sla()
returns trigger language plpgsql security definer set search_path='' as $$
declare budget double precision; due timestamptz; at_time timestamptz:=now();
begin
  if tg_op='INSERT' then
    select timezone into new.sla_timezone from public.organizations where id=new.organization_id;
    new.resolution_sla_paused_at:=null;
    new.resolution_sla_remaining_seconds:=null;
    new.sla_paused_business_seconds:=0;
    if new.status in ('resolved','closed') then new.resolved_at:=coalesce(new.resolved_at,new.created_at); end if;
    if new.status='closed' then new.closed_at:=coalesce(new.closed_at,new.created_at); end if;
    new.response_sla_due_at:=private.ticket_sla_deadline(new.created_at,new.priority,true,new.sla_timezone);
    new.resolution_sla_due_at:=private.ticket_sla_deadline(new.created_at,new.priority,false,new.sla_timezone);
  else
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
    if old.resolution_sla_paused_at is not null and new.status<>'waiting_on_user' then
      new.sla_paused_business_seconds:=old.sla_paused_business_seconds+
        greatest(0,private.sla_business_seconds(old.resolution_sla_paused_at,at_time,new.sla_timezone));
      new.resolution_sla_paused_at:=null;
      new.resolution_sla_remaining_seconds:=null;
    end if;
    if old.priority is distinct from new.priority and old.status not in ('resolved','closed') and old.first_response_at is null then
      new.response_sla_due_at:=private.ticket_sla_deadline(old.created_at,new.priority,true,new.sla_timezone);
    end if;
    if old.resolution_sla_paused_at is not null and new.status<>'waiting_on_user'
      or (old.priority is distinct from new.priority and old.status not in ('resolved','closed'))
      or (old.sla_timezone is null and new.status not in ('resolved','closed')) then
      budget:=extract(epoch from private.ticket_sla_deadline(new.created_at,new.priority,false)-new.created_at);
      new.resolution_sla_due_at:=private.sla_add_business_seconds(new.created_at,budget+new.sla_paused_business_seconds,new.sla_timezone);
    end if;
  end if;
  if new.status='waiting_on_user' and (tg_op='INSERT' or old.status<>'waiting_on_user' or old.priority is distinct from new.priority) then
    new.resolution_sla_paused_at:=coalesce(new.resolution_sla_paused_at,at_time);
    new.resolution_sla_remaining_seconds:=private.sla_business_seconds(new.resolution_sla_paused_at,new.resolution_sla_due_at,new.sla_timezone);
    -- A breach that happened before waiting stays visible and cannot be erased.
    if new.resolution_sla_remaining_seconds>0 then new.resolution_sla_due_at:=null; end if;
  end if;
  return new;
end $$;
revoke all on function private.prepare_ticket_sla() from public,anon,authenticated;

-- Reply-driven resume uses a private transaction-bound capability; employees and
-- service-role callers still cannot issue arbitrary ticket updates.
create table private.sla_reply_resume_contexts (
  transaction_id xid8 not null default pg_current_xact_id(),
  ticket_id uuid not null,
  organization_id uuid not null,
  primary key(transaction_id,ticket_id)
);
revoke all on private.sla_reply_resume_contexts from public,anon,authenticated,service_role;

create or replace function private.restrict_employee_ticket_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='waiting_on_user' and new.status='in_progress'
    and (to_jsonb(new)-array['status','sla_next_due_at']) is not distinct from (to_jsonb(old)-array['status','sla_next_due_at'])
    and exists(select 1 from private.sla_reply_resume_contexts c where c.transaction_id=pg_current_xact_id()
      and c.ticket_id=old.id and c.organization_id=old.organization_id) then return new; end if;
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
  if current_setting('role',true)<>'service_role' and not private.can_work_tickets(old.organization_id)
    and not exists(select 1 from private.ticket_reopen_receipts r where r.actor_id=auth.uid() and r.ticket_id=old.id
      and r.organization_id=old.organization_id and r.previous_revision=old.revision
      and r.request_transaction=pg_current_xact_id() and r.result_revision is null) then
    raise exception 'Use Reopen ticket and provide a reason' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.restrict_employee_ticket_update() from public,anon,authenticated;

create function private.resume_sla_on_requester_reply()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind<>'reply' then return new; end if;
  -- Lock before recording context: concurrent replies can resume only once.
  perform 1 from public.tickets t where t.id=new.ticket_id and t.organization_id=new.organization_id
    and t.requester_id=new.author_id and t.status='waiting_on_user' for update;
  if not found then return new; end if;
  insert into private.sla_reply_resume_contexts(ticket_id,organization_id) values(new.ticket_id,new.organization_id);
  update public.tickets set status='in_progress' where id=new.ticket_id and organization_id=new.organization_id;
  delete from private.sla_reply_resume_contexts where transaction_id=pg_current_xact_id() and ticket_id=new.ticket_id;
  return new;
end $$;
revoke all on function private.resume_sla_on_requester_reply() from public,anon,authenticated;
create trigger ticket_messages_resume_sla after insert on public.ticket_messages
  for each row execute function private.resume_sla_on_requester_reply();

-- Recalculate only unfinished objectives. Never manufacture historical pause time,
-- modify completed results, or emit audit, analytics, notification or automation
-- events for the one-time policy conversion.
create temporary table sla_cutover_triggers on commit drop as
  select tgname from pg_trigger where tgrelid='public.tickets'::regclass and not tgisinternal and tgenabled='O';
do $$ declare item record; begin
  for item in select tgname from sla_cutover_triggers loop
    execute format('alter table public.tickets disable trigger %I',item.tgname);
  end loop;
end $$;
update public.tickets t set
  sla_timezone=o.timezone,
  response_sla_due_at=case when t.first_response_at is null then private.ticket_sla_deadline(t.created_at,t.priority,true,o.timezone) else t.response_sla_due_at end,
  resolution_sla_due_at=private.ticket_sla_deadline(t.created_at,t.priority,false,o.timezone)
from public.organizations o where o.id=t.organization_id and t.status not in ('resolved','closed');
update public.tickets set resolution_sla_paused_at=now(),
  resolution_sla_remaining_seconds=private.sla_business_seconds(now(),resolution_sla_due_at,sla_timezone)
where status='waiting_on_user';
update public.tickets set resolution_sla_due_at=null where status='waiting_on_user' and resolution_sla_remaining_seconds>0;
do $$ declare item record; begin
  for item in select tgname from sla_cutover_triggers loop
    execute format('alter table public.tickets enable trigger %I',item.tgname);
  end loop;
end $$;

alter table public.tickets add constraint ticket_sla_pause_state check (
  (resolution_sla_paused_at is null and resolution_sla_remaining_seconds is null and resolution_sla_due_at is not null)
  or (status='waiting_on_user' and resolution_sla_paused_at is not null and resolution_sla_remaining_seconds is not null)
);
create or replace function public.enqueue_sla_notifications() returns integer language plpgsql security definer set search_path = '' as $$
declare ticket record; objective record; worker uuid; total integer := 0;
begin
 for ticket in select * from public.tickets where sla_next_due_at is not null
  and sla_next_due_at <= now()+interval '30 minutes' and status not in ('resolved','closed')
  and (sla_timezone is null or ((now() at time zone sla_timezone)::time >= time '07:00' and (now() at time zone sla_timezone)::time < time '22:00')) loop
   for objective in select 'response' as name, ticket.response_sla_due_at as deadline where ticket.first_response_at is null
     union all select 'resolution',ticket.resolution_sla_due_at loop
     if objective.deadline > now() and objective.deadline-now() <= least(interval '30 minutes',(objective.deadline-ticket.created_at)*0.2) then
       for worker in select user_id from public.organization_memberships where organization_id=ticket.organization_id and status='active'
        and role in ('technician','administrator') and (ticket.assigned_technician_id is null or user_id=ticket.assigned_technician_id) loop
         perform private.enqueue_notification(ticket.organization_id,worker,null,ticket.id,null,'sla_approaching',
          'Ticket #'||ticket.ticket_number||' '||objective.name||' SLA approaching',true,
          'sla:'||ticket.id||':'||objective.name||':'||extract(epoch from objective.deadline)::text);
         total := total+1;
       end loop;
     end if;
   end loop;
 end loop;
 return total;
end;
$$;
revoke all on function public.enqueue_sla_notifications() from public,anon,authenticated;
grant execute on function public.enqueue_sla_notifications() to service_role;


commit;
