-- Employee resolution ratings: one 1–5 score per resolution cycle, written only
-- by the requester through a checked RPC. Reopening and resolving again starts a
-- new cycle, so each resolution can be rated on its own merits.
create table public.ticket_resolution_ratings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null,
  requester_id uuid references auth.users(id) on delete set null,
  -- Snapshot of who owned the work when it was rated, for reporting.
  assigned_technician_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz not null,
  score smallint not null check (score between 1 and 5),
  comment text check (comment is null or char_length(comment) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, resolved_at),
  foreign key (organization_id, ticket_id) references public.tickets(organization_id, id) on delete cascade
);
create index ticket_resolution_ratings_org_time_idx
  on public.ticket_resolution_ratings(organization_id, created_at desc);
create index ticket_resolution_ratings_ticket_idx
  on public.ticket_resolution_ratings(organization_id, ticket_id, resolved_at desc);
create index ticket_resolution_ratings_requester_idx on public.ticket_resolution_ratings(requester_id);
create index ticket_resolution_ratings_technician_idx on public.ticket_resolution_ratings(assigned_technician_id);

alter table public.ticket_resolution_ratings enable row level security;
-- Requesters read their own ratings; IT staff read every rating in their tenant.
create policy ticket_resolution_ratings_read on public.ticket_resolution_ratings for select to authenticated
  using (
    (requester_id = (select auth.uid()) and (select private.is_active_organization_member(organization_id)))
    or (select private.can_work_tickets(organization_id))
  );
create policy require_enrolled_mfa on public.ticket_resolution_ratings as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
-- No direct writes: rate_ticket_resolution is the only path.
revoke all on public.ticket_resolution_ratings from public, anon, authenticated;
grant select on public.ticket_resolution_ratings to authenticated;
grant all on public.ticket_resolution_ratings to service_role;

create function private.rate_ticket_resolution(target uuid, rating integer, remark text)
returns smallint language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  ticket public.tickets%rowtype;
  previous smallint;
  note text := nullif(btrim(remark, E' \t\r\n'), '');
begin
  if actor is null or not private.has_required_assurance() then
    raise exception 'Rating access denied' using errcode = '42501';
  end if;
  if target is null or rating is null or rating not between 1 and 5
    or (note is not null and char_length(note) > 1000) then
    raise exception 'Choose a rating from 1 to 5 and a comment up to 1000 characters' using errcode = '22023';
  end if;
  select * into ticket from public.tickets t where t.id = target and t.requester_id = actor for share;
  if not found then raise exception 'Rating access denied' using errcode = '42501'; end if;
  perform 1 from public.organization_memberships m
    where m.organization_id = ticket.organization_id and m.user_id = actor and m.status = 'active' for share;
  if not found then raise exception 'Rating access denied' using errcode = '42501'; end if;
  if ticket.status not in ('resolved', 'closed') or ticket.resolved_at is null then
    raise exception 'Only a resolved request can be rated' using errcode = 'PT409';
  end if;
  if ticket.resolved_at < now() - interval '30 days' then
    raise exception 'Ratings close 30 days after resolution' using errcode = 'PT410';
  end if;
  select r.score into previous from public.ticket_resolution_ratings r
    where r.ticket_id = ticket.id and r.resolved_at = ticket.resolved_at for update;
  insert into public.ticket_resolution_ratings
    (organization_id, ticket_id, requester_id, assigned_technician_id, resolved_at, score, comment)
  values (ticket.organization_id, ticket.id, actor, ticket.assigned_technician_id, ticket.resolved_at, rating, note)
  on conflict (ticket_id, resolved_at) do update
    set score = excluded.score, comment = excluded.comment, updated_at = now();
  -- Unchanged resubmissions (for example, a retried request) add no history.
  if previous is distinct from rating then
    insert into public.ticket_activity (organization_id, ticket_id, actor_id, action, details)
    values (ticket.organization_id, ticket.id, actor, 'resolution_rated',
      jsonb_build_object('score', rating) || case when previous is null then '{}'::jsonb else jsonb_build_object('previous', previous) end);
  end if;
  return rating;
end $$;
revoke all on function private.rate_ticket_resolution(uuid, integer, text) from public, anon, service_role;
grant execute on function private.rate_ticket_resolution(uuid, integer, text) to authenticated;
create function public.rate_ticket_resolution(target uuid, rating integer, remark text default null)
returns smallint language sql security invoker set search_path = '' as $$
  select private.rate_ticket_resolution(target, rating, remark)
$$;
revoke all on function public.rate_ticket_resolution(uuid, integer, text) from public, anon, service_role;
grant execute on function public.rate_ticket_resolution(uuid, integer, text) to authenticated;

-- Staff satisfaction summary. Runs as the caller, so ticket and rating RLS still
-- apply; the explicit check gives employees a clear denial instead of zeros.
create function public.satisfaction_summary(target_organization_id uuid, days integer default 30)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  window_days integer := greatest(1, least(coalesce(days, 30), 366));
  since timestamptz := now() - make_interval(days => window_days);
begin
  if not private.can_work_tickets(target_organization_id) then
    raise exception 'Satisfaction reporting is available to support staff only' using errcode = '42501';
  end if;
  return (
    with rated as (
      select r.score, r.comment, r.created_at, r.updated_at, r.ticket_id
      from public.ticket_resolution_ratings r
      where r.organization_id = target_organization_id and r.created_at >= since
    )
    select jsonb_build_object(
      'days', window_days,
      'responses', (select count(*) from rated),
      'average', (select round(avg(score)::numeric, 2) from rated),
      'satisfied', (select count(*) from rated where score >= 4),
      'distribution', (
        select jsonb_agg(jsonb_build_object('score', g.s, 'count', coalesce(c.n, 0)) order by g.s desc)
        from generate_series(1, 5) g(s)
        left join (select score, count(*) n from rated group by score) c on c.score = g.s
      ),
      'comments', coalesce((
        select jsonb_agg(c order by c.updated_at desc) from (
          select rated.score, rated.comment, rated.updated_at, t.id as ticket_id, t.ticket_number, t.title
          from rated join public.tickets t on t.id = rated.ticket_id and t.organization_id = target_organization_id
          where rated.comment is not null
          order by rated.updated_at desc limit 5
        ) c
      ), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.satisfaction_summary(uuid, integer) from public, anon, service_role;
grant execute on function public.satisfaction_summary(uuid, integer) to authenticated;
