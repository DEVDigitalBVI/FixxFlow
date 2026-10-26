-- Ticket watchers: IT staff follow a ticket without being assigned and are notified
-- of public replies and resolve/reopen changes. Staff-only: employees cannot watch,
-- because that would expose other people's tickets.
create table public.ticket_watchers (
  organization_id uuid not null,
  ticket_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,ticket_id,user_id),
  foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
  foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create index ticket_watchers_user_idx on public.ticket_watchers(organization_id,user_id);

alter table public.ticket_watchers enable row level security;
create policy ticket_watchers_read on public.ticket_watchers for select to authenticated
  using ((select private.can_work_tickets(organization_id)));
-- Staff watch for themselves; they stop watching themselves, or an administrator removes anyone.
create policy ticket_watchers_watch on public.ticket_watchers for insert to authenticated
  with check ((select private.can_work_tickets(organization_id)) and user_id=(select auth.uid()));
create policy ticket_watchers_unwatch on public.ticket_watchers for delete to authenticated
  using ((select private.can_work_tickets(organization_id)) and (user_id=(select auth.uid())
    or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
create policy require_enrolled_mfa on public.ticket_watchers as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.ticket_watchers from public,anon,authenticated;
grant select,delete on public.ticket_watchers to authenticated;
grant insert(organization_id,ticket_id,user_id) on public.ticket_watchers to authenticated;
grant all on public.ticket_watchers to service_role;

-- Public replies: reuse the reply's event key so a watcher who is also the requester
-- or assignee receives one notification, not two. Internal notes notify no one.
create function private.notify_ticket_watchers_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare ticket public.tickets%rowtype; watcher uuid; from_requester boolean;
begin
  if new.kind <> 'reply' then return new; end if;
  select * into ticket from public.tickets where id=new.ticket_id and organization_id=new.organization_id;
  from_requester := new.author_id=ticket.requester_id;
  for watcher in select user_id from public.ticket_watchers where organization_id=new.organization_id and ticket_id=new.ticket_id loop
    perform private.enqueue_notification(new.organization_id,watcher,new.author_id,ticket.id,null,
      case when from_requester then 'user_replied'::public.notification_kind else 'ticket_response'::public.notification_kind end,
      case when from_requester then 'Requester replied to watched ticket #' else 'New response on watched ticket #' end||ticket.ticket_number,
      true,'ticket-message:'||new.id);
  end loop;
  return new;
end $$;
revoke all on function private.notify_ticket_watchers_reply() from public,anon,authenticated;
create trigger ticket_messages_notify_watchers after insert on public.ticket_messages
  for each row execute function private.notify_ticket_watchers_reply();

-- Resolve and reopen. The requester and assignee are already notified by notify_ticket_event.
create function private.notify_ticket_watchers_status() returns trigger language plpgsql security definer set search_path='' as $$
declare watcher uuid; event_kind public.notification_kind; heading text; event text:='watch-status:'||new.id||':'||new.revision;
begin
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    event_kind:='ticket_resolved'; heading:='Watched ticket #'||new.ticket_number||' resolved';
  elsif old.status in ('resolved','closed') and new.status not in ('resolved','closed') then
    event_kind:='ticket_reopened'; heading:='Watched ticket #'||new.ticket_number||' reopened';
  else return new; end if;
  for watcher in select user_id from public.ticket_watchers where organization_id=new.organization_id and ticket_id=new.id
    and user_id is distinct from new.requester_id and user_id is distinct from new.assigned_technician_id loop
    perform private.enqueue_notification(new.organization_id,watcher,auth.uid(),new.id,null,event_kind,heading,true,event);
  end loop;
  update private.notification_email_outbox q set previous_status=old.status,ticket_status=new.status,ticket_priority=new.priority
  from public.notifications n where q.notification_id=n.id and n.organization_id=new.organization_id and n.ticket_id=new.id
    and n.event_key=event and q.attempts=0 and q.first_attempt_at is null;
  return new;
end $$;
revoke all on function private.notify_ticket_watchers_status() from public,anon,authenticated;
create trigger tickets_notify_watchers after update of status on public.tickets
  for each row when (old.status is distinct from new.status) execute function private.notify_ticket_watchers_status();
