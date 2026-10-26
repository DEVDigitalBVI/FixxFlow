begin;
-- Announcements can be published directly from ordinary support tickets too.
alter table public.service_announcement_drafts drop constraint service_announcement_drafts_ticket_id_fkey;
alter table public.service_announcements add constraint service_announcements_org_id_unique unique(organization_id,id);
alter table public.notifications add column service_announcement_id uuid;
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check check(num_nonnulls(ticket_id,conversation_id,service_announcement_id)=1);
alter table public.notifications add constraint notifications_service_announcement_fk foreign key(organization_id,service_announcement_id)
 references public.service_announcements(organization_id,id) on delete cascade;
create index notifications_service_announcement_idx on public.notifications(service_announcement_id) where service_announcement_id is not null;
drop policy notifications_recipient on public.notifications;
create policy notifications_recipient on public.notifications for select to authenticated using (
 recipient_id=(select auth.uid()) and private.is_active_organization_member(organization_id)
 and (not staff_only or private.can_work_tickets(organization_id))
 and (case when service_announcement_id is not null then exists(select 1 from public.service_announcements a where a.id=notifications.service_announcement_id and a.organization_id=notifications.organization_id)
 when incident_bulletin_id is not null then exists(select 1 from public.incident_bulletin_recipients r where r.organization_id=notifications.organization_id and r.bulletin_id=notifications.incident_bulletin_id and r.user_id=(select auth.uid()))
 else (ticket_id is not null and private.can_view_ticket(organization_id,ticket_id)) or (conversation_id is not null and private.can_view_chat(organization_id,conversation_id)) end)
);
create or replace function private.manage_service_announcement(org uuid,ticket uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare draft public.service_announcement_drafts; workflow public.ticket_workflows;
 ticket_status public.ticket_status; assigned uuid; request_kind text; result bigint; actor_name text; heading text; message text;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then
  raise exception 'Announcement access denied' using errcode='42501'; end if;
 -- Match ticket -> announcement lock order used by the automatic withdrawal trigger.
 select status,assigned_technician_id,public.tickets.request_kind into ticket_status,assigned,request_kind from public.tickets where organization_id=org and id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 select * into workflow from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 if request_kind='inventory' then raise exception 'Announcements are unavailable for inventory requests' using errcode='42501'; end if;
 select * into draft from public.service_announcement_drafts where organization_id=org and ticket_id=ticket;
 if expected_revision is null or expected_revision<>coalesce(draft.revision,0) then
  raise exception 'Announcement changed; review the latest saved draft' using errcode='PT409'; end if;
 if ticket_status in ('resolved','closed') then raise exception 'Reopen the ticket before publishing an announcement'; end if;
 if operation='save' then
  heading:=trim(payload->>'title'); message:=trim(payload->>'body');
  if heading is null or message is null or char_length(heading) not between 3 and 180 or char_length(message) not between 3 and 3000 then
   raise exception 'Enter a title (3–180 characters) and message (3–3000 characters)'; end if;
  insert into public.service_announcement_drafts(ticket_id,organization_id,title,body,updated_by)
   values(ticket,org,heading,message,auth.uid()) on conflict(ticket_id) do update
   set title=excluded.title,body=excluded.body,updated_by=excluded.updated_by,updated_at=now(),revision=service_announcement_drafts.revision+1
   returning revision into result;
 elsif operation in ('publish','withdraw') then
  if workflow.owner_id is distinct from auth.uid() and assigned is distinct from auth.uid() and not exists(select 1 from public.organization_memberships
    where organization_id=org and user_id=auth.uid() and status='active' and role='administrator') then
   raise exception 'Only the assignee, coordinator or an administrator can publish or remove announcements' using errcode='42501'; end if;
  if draft.ticket_id is null then raise exception 'Save and review a draft first'; end if;
  if operation='publish' then
   if payload->>'confirm' is distinct from 'yes' then raise exception 'Confirm the saved message is suitable for everyone in the workspace'; end if;
   -- Retrying the same approval never republishes or creates a second notice.
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision and withdrawn_at is null) then return draft.revision; end if;
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision) then raise exception 'Save a new draft before republishing a removed announcement'; end if;
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   insert into public.service_announcements(organization_id,ticket_id,title,body,draft_revision,published_by)
    values(org,ticket,draft.title,draft.body,draft.revision,auth.uid());
  else
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   if not found then return draft.revision; end if;
  end if;
  result:=draft.revision;
 else raise exception 'Unknown announcement action'; end if;
 select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),coalesce(actor_name,'IT staff'),'service_announcements',ticket,coalesce(heading,draft.title),
 'updated',jsonb_build_array(jsonb_build_object('field','announcement_action','from',null,'to',operation)));
 return result;
end $$;

-- Capture each active member exactly once, including the publisher. Message
-- content comes only from this immutable approved snapshot, never ticket fields.
create function private.queue_service_announcement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 with recipients as (
  insert into public.notifications(organization_id,recipient_id,kind,title,staff_only,event_key,service_announcement_id)
  select new.organization_id,m.user_id,'incident_update',new.title,false,'announcement:'||new.id,new.id
  from public.organization_memberships m join auth.users u on u.id=m.user_id
  where m.organization_id=new.organization_id and m.status='active' and u.email_confirmed_at is not null and u.email is not null
  on conflict(recipient_id,event_key) do nothing returning id
 ) insert into private.notification_email_outbox(notification_id,coalesce_key,available_at) select id,id::text,now() from recipients;
 return new;
end $$;
revoke all on function private.queue_service_announcement() from public,anon,authenticated,service_role;
create trigger service_announcements_queue after insert on public.service_announcements
 for each row execute function private.queue_service_announcement();

-- A stable request key makes lost responses safe to retry without re-emailing.
create table private.service_announcement_commands (
 organization_id uuid not null,request_key uuid not null,actor_id uuid not null,ticket_id uuid not null,
 payload jsonb not null,result jsonb not null,primary key(organization_id,request_key),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
create index service_announcement_commands_ticket_idx on private.service_announcement_commands(organization_id,ticket_id);
alter table private.service_announcement_commands enable row level security;
revoke all on private.service_announcement_commands from public,anon,authenticated,service_role;
create function private.publish_employee_announcement(org uuid,ticket uuid,expected_revision bigint,heading text,message text,request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt private.service_announcement_commands; command jsonb; version bigint; announcement uuid; result jsonb;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Announcement access denied' using errcode='42501'; end if;
 if request_key is null then raise exception 'A request key is required'; end if;
 -- The same lock order is shared by legacy publication and automatic removal.
 perform 1 from public.tickets where organization_id=org and id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 command:=jsonb_build_object('ticket',ticket,'revision',expected_revision,'title',trim(heading),'body',trim(message));
 select * into receipt from private.service_announcement_commands c where c.organization_id=org and c.request_key=publish_employee_announcement.request_key;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.payload is distinct from command then raise exception 'This publication request changed' using errcode='PT409'; end if;
  return receipt.result;
 end if;
 -- Both calls are in one transaction: failed authorization/publication rolls back
 -- the draft as well. Publish itself is the explicit approval of the entered text.
 version:=private.manage_service_announcement(org,ticket,expected_revision,'save',jsonb_build_object('title',heading,'body',message));
 perform private.manage_service_announcement(org,ticket,version,'publish','{"confirm":"yes"}'::jsonb);
 select id into announcement from public.service_announcements where ticket_id=ticket and draft_revision=version;
 result:=jsonb_build_object('revision',version,'id',announcement,'recipients',(select count(*) from public.notifications where service_announcement_id=announcement));
 insert into private.service_announcement_commands values(org,request_key,auth.uid(),ticket,command,result);
 return result;
end $$;
revoke all on function private.publish_employee_announcement(uuid,uuid,bigint,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_employee_announcement(uuid,uuid,bigint,text,text,uuid) to authenticated;
create function public.publish_employee_announcement(org uuid,ticket uuid,expected_revision bigint,heading text,message text,request_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.publish_employee_announcement(org,ticket,expected_revision,heading,message,request_key);
$$;
revoke all on function public.publish_employee_announcement(uuid,uuid,bigint,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_employee_announcement(uuid,uuid,bigint,text,text,uuid) to authenticated;

drop function public.claim_notification_emails(integer);
create function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz,reopen_reason text,service_announcement_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   (n.service_announcement_id is null and n.read_at is not null and n.kind not in ('ticket_created','ticket_assigned','ticket_reassigned')) or n.created_at<now()-interval '24 hours'
   or (n.service_announcement_id is not null and not exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id and a.withdrawn_at is null))
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (m.role in ('technician','administrator')
        or exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id)
        or exists (select 1 from public.incident_bulletin_recipients r where r.organization_id=n.organization_id and r.bulletin_id=n.incident_bulletin_id and r.user_id=m.user_id)
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status,q.previous_status,q.status_changed_by,q.ticket_owner,q.reopen_reason
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||case when c.ticket_priority='critical' then 'Urgent' else initcap(c.ticket_priority::text) end end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,coalesce(a.body,b.body),b.next_update_at,case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority,c.previous_status,c.status_changed_by,c.ticket_owner,n.created_at,c.reopen_reason,n.service_announcement_id
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id left join public.service_announcements a on a.id=n.service_announcement_id and a.organization_id=n.organization_id;
end;
$$;

revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;


commit;
