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
  if frequency = 'weekly' then
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
