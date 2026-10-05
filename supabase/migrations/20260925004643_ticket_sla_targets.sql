begin;

-- Calendar-time V1. Keep deadline calculation in one database function so a future
-- business-hours policy can compute stored deadlines without changing queue reads.
create function private.ticket_sla_deadline(started_at timestamptz, priority public.ticket_priority, response boolean)
returns timestamptz language sql immutable set search_path = ''
as $$
  select started_at + make_interval(mins => case priority
    when 'critical' then case when response then 15 else 240 end
    when 'high' then case when response then 60 else 480 end
    when 'normal' then case when response then 240 else 1440 end
    when 'low' then case when response then 480 else 2880 end
  end);
$$;
revoke all on function private.ticket_sla_deadline(timestamptz, public.ticket_priority, boolean) from public, anon, authenticated;

alter table public.tickets
  add column response_sla_due_at timestamptz,
  add column resolution_sla_due_at timestamptz;

-- Backfill without changing updated_at or adding artificial activity events.
alter table public.tickets disable trigger tickets_prepare_change;
alter table public.tickets disable trigger tickets_record_change;
alter table public.tickets disable trigger tickets_a_restrict_employee_update;
update public.tickets set
  response_sla_due_at = private.ticket_sla_deadline(created_at, priority, true),
  resolution_sla_due_at = private.ticket_sla_deadline(created_at, priority, false),
  resolved_at = case when status = 'closed' then coalesce(resolved_at,
    (select max(activity.created_at) from public.ticket_activity activity
     where activity.organization_id = tickets.organization_id and activity.ticket_id = tickets.id
       and activity.action = 'status_changed' and activity.details->>'to' = 'resolved'
       and activity.created_at <= tickets.closed_at), closed_at)
    else resolved_at end;
alter table public.tickets enable trigger tickets_prepare_change;
alter table public.tickets enable trigger tickets_record_change;
alter table public.tickets enable trigger tickets_a_restrict_employee_update;
alter table public.tickets
  alter column response_sla_due_at set not null,
  alter column resolution_sla_due_at set not null;

create function private.prepare_ticket_sla()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('resolved', 'closed') then new.resolved_at := coalesce(new.resolved_at, new.created_at); end if;
    if new.status = 'closed' then new.closed_at := coalesce(new.closed_at, new.created_at); end if;
    new.response_sla_due_at := private.ticket_sla_deadline(new.created_at, new.priority, true);
    new.resolution_sla_due_at := private.ticket_sla_deadline(new.created_at, new.priority, false);
  else
    -- Completed objectives retain their target even if the priority later changes.
    new.response_sla_due_at := old.response_sla_due_at;
    new.resolution_sla_due_at := old.resolution_sla_due_at;
    if old.priority is distinct from new.priority and old.status not in ('resolved', 'closed') then
      if old.first_response_at is null then
        new.response_sla_due_at := private.ticket_sla_deadline(old.created_at, new.priority, true);
      end if;
      new.resolution_sla_due_at := private.ticket_sla_deadline(old.created_at, new.priority, false);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_ticket_sla() from public, anon, authenticated;
create trigger tickets_sla_prepare before insert or update on public.tickets
for each row execute function private.prepare_ticket_sla();

-- Preserve the resolution moment when a resolved ticket is subsequently closed.
-- Reopening resumes the original deadline; it does not grant a fresh SLA window.
create or replace function private.prepare_ticket_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    if new.status in ('resolved', 'closed') then
      new.resolved_at := coalesce(old.resolved_at, now());
    else
      new.resolved_at := null;
    end if;
    if new.status = 'closed' then new.closed_at := coalesce(old.closed_at, now());
    else new.closed_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Only a public reply by another active staff member satisfies first response.
create or replace function private.track_ticket_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'reply' and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id and m.user_id = new.author_id
      and m.status = 'active' and m.role in ('technician', 'administrator')
  ) then
    update public.tickets set first_response_at = new.created_at
    where organization_id = new.organization_id and id = new.ticket_id
      and requester_id <> new.author_id and first_response_at is null;
  end if;
  insert into public.ticket_activity (organization_id, ticket_id, actor_id, action, details)
  values (new.organization_id, new.ticket_id, new.author_id,
    case when new.kind = 'internal_note' then 'internal_note_added' else 'reply_added' end, '{}'::jsonb);
  return new;
end;
$$;

alter table public.tickets add column sla_next_due_at timestamptz generated always as (
  case when status in ('resolved', 'closed') then null
    when first_response_at is null then least(response_sla_due_at, resolution_sla_due_at)
    else resolution_sla_due_at end
) stored;
create index tickets_active_sla_due_idx on public.tickets (organization_id, sla_next_due_at)
where sla_next_due_at is not null;

commit;
