alter table public.report_schedules drop constraint report_schedules_frequency_check;
alter table public.report_schedules add constraint report_schedules_frequency_check check(frequency in ('daily','weekly','monthly'));
alter table public.report_schedules drop constraint report_schedules_check;
alter table public.report_schedules add constraint report_schedules_check check(
 (frequency='daily' and weekday is null and monthday is null)
 or (frequency='weekly' and weekday is not null and monthday is null)
 or (frequency='monthly' and weekday is null and monthday is not null));

create or replace function private.next_report_run(
  frequency text,
  weekday integer,
  monthday integer,
  run_hour integer,
  zone text,
  after_time timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_after timestamp := after_time at time zone zone;
  candidate timestamp;
  first_month date;
begin
  if frequency = 'daily' then
    candidate := date_trunc('day', local_after) + make_interval(hours => run_hour);
    -- Compare instants, so the standard-time occurrence of an ambiguous hour
    -- is used once; nonexistent spring-forward hours run at PostgreSQL's mapping.
    if (candidate at time zone zone) <= after_time then
      candidate := candidate + interval '1 day';
    end if;
  elsif frequency = 'weekly' then
    candidate := date_trunc('day', local_after)
      + make_interval(
          days => ((weekday - extract(dow from local_after)::integer) + 7) % 7,
          hours => run_hour
        );

    if candidate <= local_after then
      candidate := candidate + interval '7 days';
    end if;
  elsif frequency = 'monthly' then
    first_month := date_trunc('month', local_after)::date;
    candidate := first_month
      + make_interval(
          days => least(
            monthday,
            extract(day from (first_month + interval '1 month' - interval '1 day'))::integer
          ) - 1,
          hours => run_hour
        );

    if candidate <= local_after then
      first_month := (first_month + interval '1 month')::date;
      candidate := first_month
        + make_interval(
            days => least(
              monthday,
              extract(day from (first_month + interval '1 month' - interval '1 day'))::integer
            ) - 1,
            hours => run_hour
          );
    end if;
  else
    raise exception 'Invalid report frequency' using errcode = '22023';
  end if;

  return candidate at time zone zone;
end
$$;

revoke all on function private.next_report_run(text, integer, integer, integer, text, timestamptz)
  from public, anon, authenticated, service_role;

-- Live snapshot, not a reconstructed historical workload. Existing ticket,
-- profile and membership RLS remains in force; employees receive no rows.
create function public.technician_workload(org uuid)
returns table(user_id uuid,label text,active boolean,open_count bigint,waiting_count bigint,overdue_count bigint)
language sql stable security invoker set search_path='' as $$
 with allowed as materialized (
  select coalesce(private.can_work_tickets(org),false) and private.has_required_assurance() ok
 ), current_work as materialized (
  select t.assigned_technician_id,t.status,t.sla_next_due_at from public.tickets t cross join allowed g
  where g.ok and t.organization_id=org and t.status not in ('resolved','closed')
 ), counts as materialized (
  select assigned_technician_id,count(*) open_count,
   count(*) filter(where status='waiting_on_user') waiting_count,
   count(*) filter(where sla_next_due_at<=now()) overdue_count
  from current_work group by assigned_technician_id
 ), actors as (
  select m.user_id,coalesce(nullif(trim(p.display_name),''),'IT member') label,
    m.status='active' and m.role in ('administrator','technician') active
  from public.organization_memberships m cross join allowed g
  left join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.user_id
  where g.ok and m.organization_id=org and ((m.status='active' and m.role in ('administrator','technician'))
   or exists(select 1 from counts w where w.assigned_technician_id=m.user_id))
  union all select null::uuid,'Unassigned',true from allowed where ok
 )
 select a.user_id,a.label,a.active,coalesce(w.open_count,0),coalesce(w.waiting_count,0),coalesce(w.overdue_count,0)
 from actors a left join counts w on w.assigned_technician_id is not distinct from a.user_id
 order by coalesce(w.open_count,0) desc,lower(a.label),a.user_id nulls last;
$$;
revoke all on function public.technician_workload(uuid) from public,anon;
grant execute on function public.technician_workload(uuid) to authenticated;
