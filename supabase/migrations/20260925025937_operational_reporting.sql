-- Aggregates only; caller permissions and existing tenant RLS remain in force.
create function public.operational_report(target_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  report_now timestamptz := now();
  today date := (now() at time zone 'America/Tortola')::date;
  result jsonb;
begin
  if not exists (select 1 from public.organization_memberships m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('administrator', 'technician')) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  with base as materialized (
    select t.*, (t.created_at at time zone 'America/Tortola')::date as created_day,
      (t.first_response_at at time zone 'America/Tortola')::date as response_day,
      (t.resolved_at at time zone 'America/Tortola')::date as resolved_day,
      t.status not in ('resolved','closed') as active,
      extract(epoch from (t.first_response_at-t.created_at))/60 as response_minutes,
      extract(epoch from (t.resolved_at-t.created_at))/60 as resolution_minutes,
      coalesce(c.name,'Uncategorized') as category_name,
      coalesce(p.display_name,'Unassigned') as technician_name,
      coalesce(d.name,'No department') as department_name,
      coalesce(l.name,'No location') as location_name
    from public.tickets t
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.profiles p on p.organization_id=t.organization_id and p.user_id=t.assigned_technician_id
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.locations l on l.organization_id=t.organization_id and l.id=t.location_id
    where t.organization_id=target_organization_id and t.created_at <= report_now
  ), events as materialized (
    select a.ticket_id, (a.created_at at time zone 'America/Tortola')::date as day,
      a.details->>'from' in ('resolved','closed') and a.details->>'to' not in ('resolved','closed') as reopened,
      a.details->>'from' not in ('resolved','closed') and a.details->>'to' in ('resolved','closed') as resolved
    from public.ticket_activity a
    where a.organization_id=target_organization_id and a.action='status_changed'
      and a.created_at >= ((today-29)::timestamp at time zone 'America/Tortola') and a.created_at <= report_now
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
    'asOf',report_now,'timezone','America/Tortola','today',today,
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
$$;
revoke all on function public.operational_report(uuid) from public, anon;
grant execute on function public.operational_report(uuid) to authenticated;
