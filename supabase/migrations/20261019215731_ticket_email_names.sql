-- Capture ticket names privately when enqueuing, keeping retry payloads stable.
alter table private.notification_email_outbox add column ticket_name text;

create function private.snapshot_notification_ticket_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 select nullif(btrim(regexp_replace(t.title,'[[:space:][:cntrl:]]+',' ','g')),'') into new.ticket_name
 from public.notifications n join public.tickets t on t.id=n.ticket_id and t.organization_id=n.organization_id
 where n.id=new.notification_id and n.conversation_id is null
   and n.incident_bulletin_id is null and n.kind<>'incident_update';
 return new;
end;
$$;
revoke all on function private.snapshot_notification_ticket_name() from public,anon,authenticated;
create trigger notification_email_ticket_name before insert on private.notification_email_outbox
for each row execute function private.snapshot_notification_ticket_name();

-- Unattempted mail can adopt the new heading. Never change payloads that may
-- already have been accepted under their existing provider idempotency key.
update private.notification_email_outbox q
set ticket_name=nullif(btrim(regexp_replace(t.title,'[[:space:][:cntrl:]]+',' ','g')),'')
from public.notifications n join public.tickets t on t.id=n.ticket_id and t.organization_id=n.organization_id
where q.notification_id=n.id and q.status='pending' and q.attempts=0
 and q.first_attempt_at is null and n.conversation_id is null
 and n.incident_bulletin_id is null and n.kind<>'incident_update';

create or replace function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz)
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name
 ) select c.notification_id,c.lease_token,u.email::text,case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,b.body,b.next_update_at
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id;
end;
$$;


revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
