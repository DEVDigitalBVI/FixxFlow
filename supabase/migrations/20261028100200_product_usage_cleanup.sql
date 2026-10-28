-- Scheduled product analytics cleanup. Applies the existing retention rules
-- (expired deduplication keys; counters older than 365 UTC days) in bounded
-- batches, so inactive installations no longer depend on opted-in writes or
-- owner-run SQL. Each run is recorded for the platform console.
create table private.product_usage_cleanup_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (trigger in ('schedule', 'owner')),
  actor_id uuid,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  dedup_deleted integer not null default 0 check (dedup_deleted >= 0),
  counts_deleted integer not null default 0 check (counts_deleted >= 0),
  complete boolean not null default false
);
create index product_usage_cleanup_runs_time_idx on private.product_usage_cleanup_runs(started_at desc, id desc);
alter table private.product_usage_cleanup_runs enable row level security;
revoke all on private.product_usage_cleanup_runs from public, anon, authenticated, service_role;

create function private.purge_product_usage(row_limit integer, run_trigger text, actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget integer := greatest(1, least(coalesce(row_limit, 50000), 200000));
  batch integer;
  removed integer;
  dedup_total integer := 0;
  counts_total integer := 0;
  run_id bigint;
  cutoff date := (now() at time zone 'UTC')::date - 365;
begin
  -- One cleanup at a time; an overlapping run reports itself as skipped.
  if not pg_try_advisory_xact_lock(hashtext('fixxflow.product_usage_cleanup')) then
    return jsonb_build_object('skipped', true);
  end if;
  insert into private.product_usage_cleanup_runs(trigger, actor_id) values (run_trigger, actor) returning id into run_id;
  loop
    batch := least(5000, budget - dedup_total - counts_total);
    exit when batch <= 0;
    delete from private.product_usage_dedup d
      where d.ctid in (select x.ctid from private.product_usage_dedup x where x.expires_at < now() limit batch);
    get diagnostics removed = row_count;
    dedup_total := dedup_total + removed;
    exit when removed < batch;
  end loop;
  loop
    batch := least(5000, budget - dedup_total - counts_total);
    exit when batch <= 0;
    delete from private.product_usage_counts c
      where c.ctid in (select x.ctid from private.product_usage_counts x where x.day < cutoff limit batch);
    get diagnostics removed = row_count;
    counts_total := counts_total + removed;
    exit when removed < batch;
  end loop;
  update private.product_usage_cleanup_runs set
    finished_at = clock_timestamp(),
    dedup_deleted = dedup_total,
    counts_deleted = counts_total,
    complete = not exists (select 1 from private.product_usage_dedup where expires_at < now())
      and not exists (select 1 from private.product_usage_counts where day < cutoff)
  where id = run_id;
  return (select jsonb_build_object('skipped', false, 'dedupDeleted', r.dedup_deleted,
      'countsDeleted', r.counts_deleted, 'complete', r.complete, 'finishedAt', r.finished_at)
    from private.product_usage_cleanup_runs r where r.id = run_id);
end $$;
revoke all on function private.purge_product_usage(integer, text, uuid) from public, anon, authenticated, service_role;

-- Cron entry point: service role only.
create function public.run_product_usage_cleanup(row_limit integer default 50000)
returns jsonb language sql security definer set search_path = '' as $$
  select private.purge_product_usage(row_limit, 'schedule', null)
$$;
revoke all on function public.run_product_usage_cleanup(integer) from public, anon, authenticated;
grant execute on function public.run_product_usage_cleanup(integer) to service_role;

-- Owner console: retention status and an audited on-demand run.
create function private.platform_analytics_retention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cutoff date := (now() at time zone 'UTC')::date - 365;
begin
  if private.platform_access() <> 'ready' then
    raise exception 'Platform owner verification required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'retentionDays', 365,
    'expiredKeys', (select count(*) from private.product_usage_dedup where expires_at < now()),
    'expiredCounts', (select count(*) from private.product_usage_counts where day < cutoff),
    'lastRun', (select jsonb_build_object('trigger', r.trigger, 'startedAt', r.started_at,
        'finishedAt', r.finished_at, 'dedupDeleted', r.dedup_deleted, 'countsDeleted', r.counts_deleted,
        'complete', r.complete)
      from private.product_usage_cleanup_runs r order by r.started_at desc, r.id desc limit 1)
  );
end $$;
revoke all on function private.platform_analytics_retention() from public, anon, service_role;
grant execute on function private.platform_analytics_retention() to authenticated;
create function public.platform_analytics_retention()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.platform_analytics_retention()
$$;
revoke all on function public.platform_analytics_retention() from public, anon, service_role;
grant execute on function public.platform_analytics_retention() to authenticated;

create function private.platform_product_usage_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if private.platform_access() <> 'ready' then
    raise exception 'Platform owner verification required' using errcode = '42501';
  end if;
  result := private.purge_product_usage(50000, 'owner', auth.uid());
  if not coalesce((result ->> 'skipped')::boolean, false) then
    insert into private.platform_audit(actor_id, organization_id, action, details)
    values (auth.uid(), null, 'analytics_cleanup_run', jsonb_build_object(
      'expired_keys_removed', result ->> 'dedupDeleted',
      'daily_counts_removed', result ->> 'countsDeleted',
      'complete', result ->> 'complete'));
  end if;
  return result;
end $$;
revoke all on function private.platform_product_usage_cleanup() from public, anon, service_role;
grant execute on function private.platform_product_usage_cleanup() to authenticated;
create function public.platform_product_usage_cleanup()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.platform_product_usage_cleanup()
$$;
revoke all on function public.platform_product_usage_cleanup() from public, anon, service_role;
grant execute on function public.platform_product_usage_cleanup() to authenticated;
