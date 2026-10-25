-- Status email context is captured inside the same transaction as the change.
-- Existing attempted mail keeps its payload, with the new nullable fields empty.
alter table private.notification_email_outbox
 add column previous_status public.ticket_status,
 add column status_changed_by text,
 add column ticket_owner text;

-- Intake and ownership email are independent of inbox read state.
create or replace function private.notify_ticket_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare event text := gen_random_uuid()::text; worker uuid; heading text; event_kind public.notification_kind;
begin
 if tg_op='INSERT' then
   -- Every active administrator receives intake mail, including an admin requester.
   for worker in select user_id from public.organization_memberships
     where organization_id=new.organization_id and status='active' and role='administrator' loop
     perform private.enqueue_notification(new.organization_id,worker,null,new.id,null,
       'ticket_created','Ticket #'||new.ticket_number||' created',true,'created:'||new.id);
   end loop;
   perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,null,new.id,null,
     'ticket_assigned','Ticket #'||new.ticket_number||' assigned to you',true,'assigned:'||event);
   return new;
 end if;
 if old.assigned_technician_id is distinct from new.assigned_technician_id then
   event_kind := case when old.assigned_technician_id is null then 'ticket_assigned'::public.notification_kind else 'ticket_reassigned'::public.notification_kind end;
   perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,null,new.id,null,
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
   update private.notification_email_outbox q set
     previous_status=old.status,ticket_status=new.status,ticket_priority=new.priority,
     status_changed_by=coalesce((select nullif(btrim(regexp_replace(p.display_name,'[[:space:][:cntrl:]]+',' ','g')),'') from public.profiles p where p.organization_id=new.organization_id and p.user_id=auth.uid()),case when auth.uid() is null then 'System' else 'Team member' end),
     ticket_owner=coalesce((select nullif(btrim(regexp_replace(p.display_name,'[[:space:][:cntrl:]]+',' ','g')),'') from public.profiles p where p.organization_id=new.organization_id and p.user_id=new.assigned_technician_id),case when new.assigned_technician_id is null then 'Unassigned' else 'Staff member' end)
   from public.notifications n where q.notification_id=n.id and n.organization_id=new.organization_id and n.ticket_id=new.id and n.event_key='status:'||event
     and q.attempts=0 and q.first_attempt_at is null;
 end if;
 return new;
end;
$$;
revoke all on function private.notify_ticket_event() from public,anon,authenticated;


drop function public.claim_notification_emails(integer);
create function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   (n.read_at is not null and n.kind not in ('ticket_created','ticket_assigned','ticket_reassigned')) or n.created_at<now()-interval '24 hours'
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (m.role in ('technician','administrator')
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status,q.previous_status,q.status_changed_by,q.ticket_owner
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||initcap(c.ticket_priority::text) end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,b.body,b.next_update_at,case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority,c.previous_status,c.status_changed_by,c.ticket_owner,n.created_at
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id;
end;
$$;


revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
