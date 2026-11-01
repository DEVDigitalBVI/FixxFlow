begin;

create function private.default_sla_targets() returns jsonb language sql immutable set search_path='' as $$
  select '{"critical":{"response":15,"resolution":240},"high":{"response":60,"resolution":480},"normal":{"response":240,"resolution":1440},"low":{"response":480,"resolution":2880}}'::jsonb;
$$;
revoke all on function private.default_sla_targets() from public, anon, authenticated;

create function private.valid_sla_targets(targets jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare priority text; objective text; value numeric;
begin
  if jsonb_typeof(targets) <> 'object' or targets is null then return false; end if;
  if (select count(*) from jsonb_object_keys(targets)) <> 4 then return false; end if;
  foreach priority in array array['critical','high','normal','low'] loop
    if jsonb_typeof(targets->priority) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(targets->priority)) <> 2 then return false; end if;
    foreach objective in array array['response','resolution'] loop
      if jsonb_typeof(targets->priority->objective) is distinct from 'number' then return false; end if;
      value := (targets->priority->>objective)::numeric;
      if value <> trunc(value) or value < 1 or value > 525600 then return false; end if;
    end loop;
    if (targets->priority->>'response')::integer > (targets->priority->>'resolution')::integer then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.valid_sla_targets(jsonb) from public, anon, authenticated;

create function private.default_sla_schedule() returns jsonb language sql immutable set search_path='' as $$ select '{"days":[1,2,3,4,5,6,7],"opens":420,"closes":1320}'::jsonb; $$;
revoke all on function private.default_sla_schedule() from public,anon,authenticated;
create function private.valid_sla_schedule(schedule jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare day jsonb; n numeric;
begin
  if schedule is null or jsonb_typeof(schedule) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(schedule)) <> 3 or jsonb_typeof(schedule->'days') is distinct from 'array' then return false; end if;
  if jsonb_array_length(schedule->'days') not between 1 and 7 then return false; end if;
  if (select count(distinct value) from jsonb_array_elements(schedule->'days')) <> jsonb_array_length(schedule->'days') then return false; end if;
  for day in select value from jsonb_array_elements(schedule->'days') loop
    if jsonb_typeof(day) <> 'number' or day::text::numeric not in (1,2,3,4,5,6,7) then return false; end if;
  end loop;
  foreach n in array array[(schedule->>'opens')::numeric,(schedule->>'closes')::numeric] loop
    if n is null or n<>trunc(n) then return false; end if;
  end loop;
  return jsonb_typeof(schedule->'opens')='number' and jsonb_typeof(schedule->'closes')='number'
    and (schedule->>'opens')::integer between 0 and 1439 and (schedule->>'closes')::integer between 1 and 1440
    and (schedule->>'closes')::integer>(schedule->>'opens')::integer;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function private.valid_sla_schedule(jsonb) from public,anon,authenticated;

create function private.sla_business_seconds(start_at timestamptz,end_at timestamptz,zone text,schedule jsonb)
returns double precision language sql stable set search_path='' as $$
 select case when end_at<start_at then -private.sla_business_seconds(end_at,start_at,zone,schedule)
 else coalesce(sum(greatest(0,extract(epoch from (
 least(end_at,(day::date+make_interval(mins=>(schedule->>'closes')::integer)) at time zone zone)
 -greatest(start_at,(day::date+make_interval(mins=>(schedule->>'opens')::integer)) at time zone zone)
 )))),0)::double precision end
 from generate_series((least(start_at,end_at) at time zone zone)::date::timestamp,
 (greatest(start_at,end_at) at time zone zone)::date::timestamp,interval '1 day') day
 where schedule->'days' @> to_jsonb(extract(isodow from day)::integer);
$$;
revoke all on function private.sla_business_seconds(timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
create function private.sla_add_business_seconds(start_at timestamptz,seconds double precision,zone text,schedule jsonb)
returns timestamptz language plpgsql stable set search_path='' as $$
declare cursor_at timestamptz:=start_at; remaining double precision:=seconds;
 day date; opens timestamptz; closes timestamptz; available double precision;
begin
 if seconds is null or seconds<0 or seconds='Infinity'::double precision or seconds='NaN'::double precision or not isfinite(start_at)
 or not private.valid_sla_schedule(schedule) then raise exception 'Invalid SLA schedule or duration'; end if;
 loop
  day:=(cursor_at at time zone zone)::date;
  opens:=(day+make_interval(mins=>(schedule->>'opens')::integer)) at time zone zone;
  closes:=(day+make_interval(mins=>(schedule->>'closes')::integer)) at time zone zone;
  cursor_at:=greatest(cursor_at,opens);
  if schedule->'days' @> to_jsonb(extract(isodow from day)::integer) then
   available:=greatest(0,extract(epoch from closes-cursor_at));
   if remaining<=available and cursor_at<=closes then return cursor_at+make_interval(secs=>remaining); end if;
   remaining:=remaining-available;
  end if;
  cursor_at:=((day+1)+make_interval(mins=>(schedule->>'opens')::integer)) at time zone zone;
 end loop;
end $$;
revoke all on function private.sla_add_business_seconds(timestamptz,double precision,text,jsonb) from public,anon,authenticated;

create table private.organization_sla_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  targets jsonb not null check(private.valid_sla_targets(targets)),
  schedule jsonb not null check(private.valid_sla_schedule(schedule)),
  version integer not null default 1 check(version > 0)
);
alter table private.organization_sla_policies enable row level security;
revoke all on private.organization_sla_policies from public, anon, authenticated;

create function private.organization_sla_policy(org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_active_organization_member(org) then raise exception 'Workspace access required' using errcode='42501'; end if;
  select jsonb_build_object('version',version,'targets',targets,'schedule',schedule) into result from private.organization_sla_policies where organization_id=org;
  return coalesce(result,jsonb_build_object('version',0,'targets',private.default_sla_targets(),'schedule',private.default_sla_schedule()));
end $$;
revoke all on function private.organization_sla_policy(uuid) from public, anon, authenticated;
grant execute on function private.organization_sla_policy(uuid) to authenticated;
create function public.organization_sla_policy(org uuid) returns jsonb language sql security invoker set search_path='' as $$
  select private.organization_sla_policy(org);
$$;
revoke all on function public.organization_sla_policy(uuid) from public, anon, authenticated;
grant execute on function public.organization_sla_policy(uuid) to authenticated;

create function private.save_organization_sla_policy(org uuid, expected_version integer, targets jsonb, schedule jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare current_version integer; previous jsonb; previous_schedule jsonb; next_version integer; actor_name text;
begin
  if not private.has_organization_role(org,array['administrator']::public.app_role[]) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if not private.valid_sla_targets(targets) or not private.valid_sla_schedule(schedule) then raise exception 'Invalid SLA targets' using errcode='22023'; end if;
  perform 1 from public.organizations where id=org for update;
  select p.version,p.targets,p.schedule into current_version,previous,previous_schedule from private.organization_sla_policies p where organization_id=org;
  if expected_version is null or expected_version <> coalesce(current_version,0) then raise exception 'SLA settings changed. Reload before saving.' using errcode='40001'; end if;
  next_version:=coalesce(current_version,0)+1;
  insert into private.organization_sla_policies(organization_id,targets,schedule,version) values(org,targets,schedule,next_version)
    on conflict(organization_id) do update set targets=excluded.targets,schedule=excluded.schedule,version=excluded.version;
  select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
    values(org,auth.uid(),coalesce(actor_name,'Administrator'),'organization_sla_policies',org,'SLA targets','updated',
      jsonb_build_array(jsonb_build_object('field','targets','from',coalesce(previous,private.default_sla_targets()),'to',targets),jsonb_build_object('field','schedule','from',coalesce(previous_schedule,private.default_sla_schedule()),'to',schedule)));
  return next_version;
end $$;
revoke all on function private.save_organization_sla_policy(uuid,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.save_organization_sla_policy(uuid,integer,jsonb,jsonb) to authenticated;
create function public.save_organization_sla_policy(org uuid,expected_version integer,targets jsonb,schedule jsonb) returns integer language sql security invoker set search_path='' as $$
  select private.save_organization_sla_policy(org,expected_version,targets,schedule);
$$;
revoke all on function public.save_organization_sla_policy(uuid,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_organization_sla_policy(uuid,integer,jsonb,jsonb) to authenticated;

-- A whole-policy snapshot preserves promises during later priority changes,
-- waiting/resume and reopen, without rewriting ticket history at policy save.
alter table public.tickets add column sla_targets jsonb, add column sla_schedule jsonb;
revoke insert(sla_targets,sla_schedule),update(sla_targets,sla_schedule) on public.tickets from anon,authenticated;
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
    if old.resolution_sla_paused_at is not null and new.status<>'waiting_on_user' then
      new.sla_paused_business_seconds:=old.sla_paused_business_seconds+
        greatest(0,private.sla_business_seconds(old.resolution_sla_paused_at,at_time,new.sla_timezone,new.sla_schedule));
      new.resolution_sla_paused_at:=null;
      new.resolution_sla_remaining_seconds:=null;
    end if;
    if old.priority is distinct from new.priority and old.status not in ('resolved','closed') and old.first_response_at is null then
      new.response_sla_due_at:=private.sla_add_business_seconds(old.created_at,(new.sla_targets->new.priority::text->>'response')::integer*60.0,new.sla_timezone,new.sla_schedule);
    end if;
    if old.resolution_sla_paused_at is not null and new.status<>'waiting_on_user'
      or (old.priority is distinct from new.priority and old.status not in ('resolved','closed'))
      or (old.sla_timezone is null and new.status not in ('resolved','closed')) then
      budget:=(new.sla_targets->new.priority::text->>'resolution')::integer*60.0;
      new.resolution_sla_due_at:=private.sla_add_business_seconds(new.created_at,budget+new.sla_paused_business_seconds,new.sla_timezone,new.sla_schedule);
    end if;
  end if;
  if new.status='waiting_on_user' and (tg_op='INSERT' or old.status<>'waiting_on_user' or old.priority is distinct from new.priority) then
    new.resolution_sla_paused_at:=coalesce(new.resolution_sla_paused_at,at_time);
    new.resolution_sla_remaining_seconds:=private.sla_business_seconds(new.resolution_sla_paused_at,new.resolution_sla_due_at,new.sla_timezone,new.sla_schedule);
    -- A breach that happened before waiting stays visible and cannot be erased.
    if new.resolution_sla_remaining_seconds>0 then new.resolution_sla_due_at:=null; end if;
  end if;
  return new;
end $$;
revoke all on function private.prepare_ticket_sla() from public,anon,authenticated;


create or replace function public.enqueue_sla_notifications() returns integer language plpgsql security definer set search_path = '' as $$
declare ticket record; objective record; worker uuid; total integer := 0;
begin
 for ticket in select * from public.tickets where sla_next_due_at is not null
  and sla_next_due_at <= now()+interval '30 minutes' and status not in ('resolved','closed')
  and (sla_timezone is null or (coalesce(sla_schedule,private.default_sla_schedule())->'days' @> to_jsonb(extract(isodow from now() at time zone sla_timezone)::integer) and extract(epoch from (now() at time zone sla_timezone)::time)/60 >= (coalesce(sla_schedule,private.default_sla_schedule())->>'opens')::integer and extract(epoch from (now() at time zone sla_timezone)::time)/60 < (coalesce(sla_schedule,private.default_sla_schedule())->>'closes')::integer)) loop
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

notify pgrst, 'reload schema';
commit;
