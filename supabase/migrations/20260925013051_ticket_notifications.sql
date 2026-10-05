begin;

create type public.notification_kind as enum ('ticket_assigned','ticket_response','new_chat',
 'ticket_reassigned','sla_approaching','ticket_resolved','ticket_reopened','user_replied','chat_response');
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 recipient_id uuid not null,
 ticket_id uuid,
 conversation_id uuid,
 kind public.notification_kind not null,
 title text not null,
 staff_only boolean not null default false,
 event_key text not null,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 check (num_nonnulls(ticket_id, conversation_id) = 1),
 unique (recipient_id, event_key),
 foreign key (organization_id,recipient_id) references public.organization_memberships(organization_id,user_id) on delete cascade,
 foreign key (organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key (organization_id,conversation_id) references public.chat_conversations(organization_id,id) on delete cascade
);
create index notifications_inbox_idx on public.notifications (organization_id,recipient_id,created_at desc,id desc);
create index notifications_unread_idx on public.notifications (organization_id,recipient_id) where read_at is null;
create index notifications_ticket_idx on public.notifications (organization_id,ticket_id) where ticket_id is not null;
create index notifications_chat_idx on public.notifications (organization_id,conversation_id) where conversation_id is not null;

alter table public.notifications enable row level security;
create policy notifications_recipient on public.notifications for select to authenticated using (
 recipient_id = (select auth.uid()) and (select private.is_active_organization_member(organization_id))
 and (not staff_only or (select private.can_work_tickets(organization_id)))
 and ((ticket_id is not null and (select private.can_view_ticket(organization_id,ticket_id)))
   or (conversation_id is not null and (select private.can_view_chat(organization_id,conversation_id))))
);
create policy notifications_mark_read on public.notifications for update to authenticated
 using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy require_enrolled_mfa on public.notifications as restrictive for all to authenticated
 using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- The outbox is not exposed through the Data API. No email addresses or bodies in browser-visible rows.
create table private.notification_email_outbox (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 coalesce_key text not null unique,
 status text not null default 'pending' check (status in ('pending','sending','sent','skipped','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now() + interval '1 minute',
 lease_token uuid,
 lease_until timestamptz,
 first_attempt_at timestamptz,
 delivered_at timestamptz,
 provider_id text,
 last_error text
);
alter table private.notification_email_outbox enable row level security;
revoke all on private.notification_email_outbox from public, anon, authenticated;
create index notification_email_ready_idx on private.notification_email_outbox (available_at)
 where status in ('pending','sending');

create function private.enqueue_notification(org uuid, recipient uuid, actor uuid,
 ticket uuid, chat uuid, event_kind public.notification_kind, heading text, staff boolean, event text)
returns void language plpgsql security definer set search_path = '' as $$
declare notification uuid;
begin
 if recipient is null or recipient is not distinct from actor then return; end if;
 if not exists (select 1 from public.organization_memberships m where m.organization_id=org
   and m.user_id=recipient and m.status='active' and (not staff or m.role in ('technician','administrator')))
 then return; end if;
 insert into public.notifications (organization_id,recipient_id,ticket_id,conversation_id,kind,title,staff_only,event_key)
 values (org,recipient,ticket,chat,event_kind,heading,staff,event)
 on conflict (recipient_id,event_key) do nothing returning id into notification;
 if notification is not null then
   insert into private.notification_email_outbox(notification_id,coalesce_key) values (notification,
     case when event_kind in ('ticket_response','chat_response','user_replied') then
       'reply:'||recipient||':'||coalesce(ticket,chat)||':'||floor(extract(epoch from now())/300)::text
     else notification::text end) on conflict (coalesce_key) do nothing;
 end if;
end;
$$;
revoke all on function private.enqueue_notification(uuid,uuid,uuid,uuid,uuid,public.notification_kind,text,boolean,text) from public,anon,authenticated;

create function private.notify_ticket_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare event text := gen_random_uuid()::text; worker uuid; heading text; event_kind public.notification_kind;
begin
 if tg_op='INSERT' then
   perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,auth.uid(),new.id,null,
     'ticket_assigned','Ticket #'||new.ticket_number||' assigned to you',true,'assigned:'||event);
   return new;
 end if;
 if old.assigned_technician_id is distinct from new.assigned_technician_id then
   event_kind := case when old.assigned_technician_id is null then 'ticket_assigned'::public.notification_kind else 'ticket_reassigned'::public.notification_kind end;
   perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,auth.uid(),new.id,null,
     event_kind,'Ticket #'||new.ticket_number||' assigned to you',true,'assigned:'||event);
   perform private.enqueue_notification(new.organization_id,old.assigned_technician_id,auth.uid(),new.id,null,
     'ticket_reassigned','Ticket #'||new.ticket_number||' reassigned',true,'reassigned:'||event);
 end if;
 if old.status is distinct from new.status then
   if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
     event_kind := 'ticket_resolved'; heading := 'Ticket #'||new.ticket_number||' resolved';
   elsif old.status in ('resolved','closed') and new.status not in ('resolved','closed') then
     event_kind := 'ticket_reopened'; heading := 'Ticket #'||new.ticket_number||' reopened';
   else return new; end if;
   perform private.enqueue_notification(new.organization_id,new.requester_id,auth.uid(),new.id,null,event_kind,heading,false,'status:'||event);
   if new.assigned_technician_id is not null then
     perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,auth.uid(),new.id,null,event_kind,heading,true,'status:'||event);
   elsif event_kind='ticket_reopened' then
     for worker in select user_id from public.organization_memberships where organization_id=new.organization_id and status='active' and role in ('technician','administrator') loop
       perform private.enqueue_notification(new.organization_id,worker,auth.uid(),new.id,null,event_kind,heading,true,'status:'||event);
     end loop;
   end if;
 end if;
 return new;
end;
$$;
revoke all on function private.notify_ticket_event() from public,anon,authenticated;
create trigger tickets_notify after insert or update on public.tickets for each row execute function private.notify_ticket_event();

create function private.notify_ticket_reply() returns trigger language plpgsql security definer set search_path = '' as $$
declare ticket public.tickets%rowtype; worker uuid;
begin
 if new.kind <> 'reply' then return new; end if;
 select * into ticket from public.tickets where id=new.ticket_id and organization_id=new.organization_id;
 if new.author_id=ticket.requester_id then
   for worker in select user_id from public.organization_memberships where organization_id=new.organization_id and status='active'
    and role in ('technician','administrator') and (ticket.assigned_technician_id is null or user_id=ticket.assigned_technician_id) loop
     perform private.enqueue_notification(new.organization_id,worker,new.author_id,ticket.id,null,'user_replied',
       'Requester replied to ticket #'||ticket.ticket_number,true,'ticket-message:'||new.id);
   end loop;
 else
   perform private.enqueue_notification(new.organization_id,ticket.requester_id,new.author_id,ticket.id,null,'ticket_response',
     'New response on ticket #'||ticket.ticket_number,false,'ticket-message:'||new.id);
   perform private.enqueue_notification(new.organization_id,ticket.assigned_technician_id,new.author_id,ticket.id,null,'ticket_response',
     'New response on ticket #'||ticket.ticket_number,true,'ticket-message:'||new.id);
 end if;
 return new;
end;
$$;
revoke all on function private.notify_ticket_reply() from public,anon,authenticated;
create trigger ticket_messages_notify after insert on public.ticket_messages for each row execute function private.notify_ticket_reply();

create function private.notify_chat_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare worker uuid;
begin
 for worker in select user_id from public.organization_memberships where organization_id=new.organization_id
   and status='active' and role in ('technician','administrator') loop
   perform private.enqueue_notification(new.organization_id,worker,auth.uid(),null,new.id,'new_chat','New support chat',true,'new-chat:'||new.id);
 end loop;
 return new;
end;
$$;
revoke all on function private.notify_chat_event() from public,anon,authenticated;
create trigger chat_conversations_notify after insert on public.chat_conversations for each row execute function private.notify_chat_event();

create function private.notify_chat_reply() returns trigger language plpgsql security definer set search_path = '' as $$
declare chat public.chat_conversations%rowtype; worker uuid;
begin
 if new.kind <> 'message' then return new; end if;
 select * into chat from public.chat_conversations where id=new.conversation_id and organization_id=new.organization_id;
 -- The first public message is already represented by the new-chat alert.
 if not exists (select 1 from public.chat_messages where conversation_id=new.conversation_id and kind='message' and id<>new.id) then return new; end if;
 if new.author_id=chat.requester_id then
   for worker in select user_id from public.organization_memberships where organization_id=new.organization_id and status='active'
    and role in ('technician','administrator') and (chat.assigned_technician_id is null or user_id=chat.assigned_technician_id) loop
     perform private.enqueue_notification(new.organization_id,worker,new.author_id,null,chat.id,'user_replied','New reply in support chat',true,'chat-message:'||new.id);
   end loop;
 else
   perform private.enqueue_notification(new.organization_id,chat.requester_id,new.author_id,null,chat.id,'chat_response','New response in support chat',false,'chat-message:'||new.id);
 end if;
 return new;
end;
$$;
revoke all on function private.notify_chat_reply() from public,anon,authenticated;
create trigger chat_messages_notify after insert on public.chat_messages for each row execute function private.notify_chat_reply();

create function public.enqueue_sla_notifications() returns integer language plpgsql security definer set search_path = '' as $$
declare ticket record; objective record; worker uuid; total integer := 0;
begin
 for ticket in select * from public.tickets where sla_next_due_at is not null
  and sla_next_due_at <= now()+interval '30 minutes' and status not in ('resolved','closed') loop
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

-- Service-only dispatcher, with leases for overlapping cron runs and bounded retries.
create function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   n.read_at is not null or n.created_at<now()-interval '24 hours'
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (m.role in ('technician','administrator')
        or exists (select 1 from public.tickets t where t.id=n.ticket_id and t.requester_id=m.user_id)
        or exists (select 1 from public.chat_conversations c where c.id=n.conversation_id and c.requester_id=m.user_id)))
 );
 -- Never retry after the provider's 24-hour idempotency window.
 update private.notification_email_outbox set status='failed',last_error='Retry window expired'
 where status in ('pending','sending') and (attempts>=6 or first_attempt_at<now()-interval '23 hours')
 and (status='pending' or lease_until<now());
 return query with candidates as (
  select q.notification_id from private.notification_email_outbox q
  where ((q.status='pending' and q.available_at<=now()) or (q.status='sending' and q.lease_until<now()))
  order by q.available_at for update skip locked limit greatest(1,least(batch_size,20))
 ), claimed as (
  update private.notification_email_outbox q set status='sending',attempts=q.attempts+1,
   lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(q.first_attempt_at,now())
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token
 ) select c.notification_id,c.lease_token,u.email,n.title,n.ticket_id,n.conversation_id
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id;
end;
$$;
revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

create function public.finish_notification_email(target_id uuid,token uuid,provider_message_id text default null,failure text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
 update private.notification_email_outbox set
  status=case when failure is null then 'sent' when attempts>=6 then 'failed' else 'pending' end,
  delivered_at=case when failure is null then now() else null end,
  provider_id=provider_message_id,last_error=left(failure,200),lease_until=null,
  available_at=now()+make_interval(mins=>least(60,power(2,attempts)::integer))
 where notification_id=target_id and lease_token=token and status='sending';
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;
revoke all on function public.finish_notification_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_notification_email(uuid,uuid,text,text) to service_role;

commit;
