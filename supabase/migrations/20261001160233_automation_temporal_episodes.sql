-- No historical backfill: unknown starts remain unknown until a real transition.
begin;
alter table public.tickets
  add column unassigned_since timestamptz,
  add column unassigned_episode_id uuid,
  add column waiting_on_user_since timestamptz,
  add column waiting_on_user_episode_id uuid,
  add check ((unassigned_since is null)=(unassigned_episode_id is null)),
  add check ((waiting_on_user_since is null)=(waiting_on_user_episode_id is null)),
  add check (unassigned_since is null or assigned_technician_id is null),
  add check (waiting_on_user_since is null or status='waiting_on_user');
revoke insert(unassigned_since,unassigned_episode_id,waiting_on_user_since,waiting_on_user_episode_id),
  update(unassigned_since,unassigned_episode_id,waiting_on_user_since,waiting_on_user_episode_id) on public.tickets from anon,authenticated,service_role;
create function private.prepare_ticket_episodes() returns trigger
language plpgsql set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if tg_op='INSERT' then
    new.unassigned_since:=null; new.unassigned_episode_id:=null;
    new.waiting_on_user_since:=null; new.waiting_on_user_episode_id:=null;
    if new.assigned_technician_id is null then new.unassigned_since:=stamp; new.unassigned_episode_id:=gen_random_uuid(); end if;
    if new.status='waiting_on_user' then new.waiting_on_user_since:=stamp; new.waiting_on_user_episode_id:=gen_random_uuid(); end if;
  else
    new.unassigned_since:=old.unassigned_since; new.unassigned_episode_id:=old.unassigned_episode_id;
    new.waiting_on_user_since:=old.waiting_on_user_since; new.waiting_on_user_episode_id:=old.waiting_on_user_episode_id;
    if old.assigned_technician_id is not null and new.assigned_technician_id is null then
      new.unassigned_since:=stamp; new.unassigned_episode_id:=gen_random_uuid();
    end if;
    if new.assigned_technician_id is not null then new.unassigned_since:=null; new.unassigned_episode_id:=null; end if;
    if old.status<>'waiting_on_user' and new.status='waiting_on_user' then
      new.waiting_on_user_since:=stamp; new.waiting_on_user_episode_id:=gen_random_uuid();
    end if;
    if new.status<>'waiting_on_user' then new.waiting_on_user_since:=null; new.waiting_on_user_episode_id:=null; end if;
  end if;
  return new;
end $$;
-- Employee guard, routing and SLA preparation run first; revision and AFTER
-- event capture observe the final episode. No extra revision or UPDATE is added.
create trigger tickets_y_temporal_episodes before insert or update on public.tickets
for each row execute function private.prepare_ticket_episodes();
revoke all on function private.prepare_ticket_episodes() from public,anon,authenticated,service_role;

-- Preserve the ordinary snapshot allowlist and add only trusted temporal facts.
alter function private.ticket_event_snapshot(public.tickets) rename to ticket_event_snapshot_before_temporal;
create function private.ticket_event_snapshot(ticket public.tickets) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.ticket_event_snapshot_before_temporal(ticket)||jsonb_build_object(
    'created_at',ticket.created_at,'unassigned_since',ticket.unassigned_since,'unassigned_episode_id',ticket.unassigned_episode_id,
    'waiting_on_user_since',ticket.waiting_on_user_since,'waiting_on_user_episode_id',ticket.waiting_on_user_episode_id,
    'response_sla_due_at',ticket.response_sla_due_at,'resolution_sla_due_at',ticket.resolution_sla_due_at,
    'resolved_at',ticket.resolved_at,'closed_at',ticket.closed_at);
$$;
revoke all on function private.ticket_event_snapshot(public.tickets),private.ticket_event_snapshot_before_temporal(public.tickets) from public,anon,authenticated,service_role;
commit;
