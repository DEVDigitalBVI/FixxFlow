-- Snapshot only the public reply identified by this notification's event key.
-- No latest-message lookup: later internal notes and edits cannot leak into mail.
alter table private.notification_email_outbox
 add column reply_author text,
 add column reply_preview text,
 add column reply_created_at timestamptz,
 add column ticket_status public.ticket_status;

create function private.snapshot_notification_reply_context() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 select coalesce(nullif(btrim(regexp_replace(p.display_name,'[[:space:][:cntrl:]]+',' ','g')),''),case when n.kind='user_replied' then 'Requester' else 'Support team' end),
   case when char_length(btrim(m.body))>320 then left(btrim(m.body),320)||'…' else btrim(m.body) end,
   m.created_at,t.status,t.priority
 into new.reply_author,new.reply_preview,new.reply_created_at,new.ticket_status,new.ticket_priority
 from public.notifications n
 join public.ticket_messages m on m.organization_id=n.organization_id and m.ticket_id=n.ticket_id and n.event_key='ticket-message:'||m.id::text and m.kind='reply'
 join public.tickets t on t.organization_id=n.organization_id and t.id=n.ticket_id
 left join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.author_id
 where n.id=new.notification_id and n.conversation_id is null and n.incident_bulletin_id is null
 and n.kind in ('ticket_response','user_replied');
 -- Runs after intake snapshotting; the trigger condition preserves intake priority.
 return new;
end;
$$;
revoke all on function private.snapshot_notification_reply_context() from public,anon,authenticated;
create trigger notification_email_z_reply_context before insert on private.notification_email_outbox
 for each row when (new.ticket_priority is null) execute function private.snapshot_notification_reply_context();

-- Safe upgrade: never modify an email that might already have reached Resend.
update private.notification_email_outbox q set
 reply_author=coalesce(nullif(btrim(regexp_replace(p.display_name,'[[:space:][:cntrl:]]+',' ','g')),''),case when n.kind='user_replied' then 'Requester' else 'Support team' end),
 reply_preview=case when char_length(btrim(m.body))>320 then left(btrim(m.body),320)||'…' else btrim(m.body) end,
 reply_created_at=m.created_at,ticket_status=t.status,ticket_priority=t.priority
from public.notifications n
join public.ticket_messages m on m.organization_id=n.organization_id and m.ticket_id=n.ticket_id and n.event_key='ticket-message:'||m.id::text and m.kind='reply'
join public.tickets t on t.organization_id=n.organization_id and t.id=n.ticket_id
left join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.author_id
where q.notification_id=n.id and q.status='pending' and q.attempts=0 and q.first_attempt_at is null
 and q.email_reason_version=1 and n.conversation_id is null and n.incident_bulletin_id is null and n.kind in ('ticket_response','user_replied');

drop function public.claim_notification_emails(integer);
create function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority)
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||initcap(c.ticket_priority::text) end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,b.body,b.next_update_at,case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id;
end;
$$;


revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
