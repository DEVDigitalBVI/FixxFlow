-- Preserve existing pilot reporting days; new workspaces choose a zone (UTC fallback).
alter table public.organizations add column timezone text not null default 'America/Tortola';
alter table public.organizations alter column timezone set default 'UTC';
alter table public.profiles add column timezone text;

create function private.validate_timezone() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.timezone is not null and (new.timezone <> 'UTC' and position('/' in new.timezone) = 0
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone)) then
    raise exception 'Invalid named timezone' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.validate_timezone() from public, anon;
grant execute on function private.validate_timezone() to authenticated, service_role;
create trigger organizations_validate_timezone before insert or update of timezone on public.organizations for each row execute function private.validate_timezone();
create trigger profiles_validate_timezone before insert or update of timezone on public.profiles for each row execute function private.validate_timezone();
grant update (timezone) on public.organizations, public.profiles to authenticated;

-- Aggregates only; caller permissions and existing tenant RLS remain in force.
create or replace function public.operational_report(target_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
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
      coalesce(l.name,'No location') as location_name
    from public.tickets t
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.profiles p on p.organization_id=t.organization_id and p.user_id=t.assigned_technician_id
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.locations l on l.organization_id=t.organization_id and l.id=t.location_id
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
$$;
revoke all on function public.operational_report(uuid) from public, anon;
grant execute on function public.operational_report(uuid) to authenticated;

-- Atomic setup with a zone, retaining the existing bootstrap's verification and locks.
create function public.bootstrap_organization(organization_name text, organization_slug text, administrator_name text, administrator_user_id uuid, organization_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 result := public.bootstrap_organization(organization_name, organization_slug, administrator_name, administrator_user_id);
 update public.organizations set timezone = organization_timezone where id = result;
 return result;
end $$;
revoke all on function public.bootstrap_organization(text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text,text,text,uuid,text) to service_role;

create function private.manage_customer(target uuid,customer_name text,customer_slug text,admin_email text,admin_name text,organization_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 result := private.manage_customer(target,customer_name,customer_slug,admin_email,admin_name);
 if target is null then update public.organizations set timezone = organization_timezone where id = result; end if;
 return result;
end $$;
revoke all on function private.manage_customer(uuid,text,text,text,text,text) from public,anon;
grant execute on function private.manage_customer(uuid,text,text,text,text,text) to authenticated;
create function public.manage_customer(target uuid,customer_name text,customer_slug text,admin_email text,admin_name text,organization_timezone text)
returns uuid language sql security invoker set search_path = '' as $$select private.manage_customer(target,customer_name,customer_slug,admin_email,admin_name,organization_timezone);$$;
revoke all on function public.manage_customer(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.manage_customer(uuid,text,text,text,text,text) to authenticated;
