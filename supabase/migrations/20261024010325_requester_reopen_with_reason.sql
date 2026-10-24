-- Requester-only reopen receipts keep reason, event capture and retries atomic.
create table private.ticket_reopen_receipts (
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_token uuid not null,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 ticket_id uuid not null references public.tickets(id) on delete cascade,
 reason text not null check(char_length(btrim(reason)) between 1 and 2000),
 fingerprint text not null,
 previous_revision bigint,
 request_transaction xid8 not null default pg_current_xact_id(),
 result_revision bigint,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_token)
);
alter table private.ticket_reopen_receipts enable row level security;
revoke all on private.ticket_reopen_receipts from public,anon,authenticated,service_role;

create function private.requester_reopen_ticket(target uuid, expected_revision bigint, explanation text, token uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket public.tickets%rowtype; receipt private.ticket_reopen_receipts%rowtype; result bigint; reason text:=btrim(explanation,E' \t\r\n'); digest text;
begin
 if actor is null or not private.has_required_assurance() then raise exception 'Reopen access denied' using errcode='42501'; end if;
 if target is null or token is null or expected_revision is null or expected_revision<1 or reason is null or char_length(reason) not between 1 and 2000 then raise exception 'Enter a reason up to 2000 characters' using errcode='22023'; end if;
 select * into ticket from public.tickets t where t.id=target and t.requester_id=actor;
 if not found then raise exception 'Reopen access denied' using errcode='42501'; end if;
 perform 1 from public.organization_memberships m where m.organization_id=ticket.organization_id and m.user_id=actor and m.status='active' for share;
 if not found then raise exception 'Reopen access denied' using errcode='42501'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('ticket',target,'revision',expected_revision,'reason',reason)::text,'UTF8')),'hex');
 insert into private.ticket_reopen_receipts(actor_id,request_token,organization_id,ticket_id,reason,fingerprint)
 values(actor,token,ticket.organization_id,target,reason,digest) on conflict do nothing;
 select * into receipt from private.ticket_reopen_receipts r where r.actor_id=actor and r.request_token=token for update;
 if receipt.fingerprint<>digest or receipt.ticket_id<>target then raise exception 'Reopen request was already used with different details' using errcode='PT409'; end if;
 if receipt.result_revision is not null then return receipt.result_revision; end if;
 select * into ticket from public.tickets t where t.id=target and t.requester_id=actor for update;
 if not found then raise exception 'Reopen access denied' using errcode='42501'; end if;
 if ticket.revision<>expected_revision or ticket.status not in ('resolved','closed') then raise exception 'Ticket changed; review its current status before reopening' using errcode='PT409'; end if;
 update private.ticket_reopen_receipts r set previous_revision=ticket.revision,request_transaction=pg_current_xact_id() where r.actor_id=actor and r.request_token=token;
 update public.tickets t set status='open' where t.id=target returning t.revision into result;
 update private.ticket_reopen_receipts r set result_revision=result where r.actor_id=actor and r.request_token=token;
 return result;
end;
$$;
revoke all on function private.requester_reopen_ticket(uuid,bigint,text,uuid) from public,anon,service_role;
grant execute on function private.requester_reopen_ticket(uuid,bigint,text,uuid) to authenticated;
create function public.reopen_ticket(target uuid, expected_revision bigint, explanation text, token uuid)
returns bigint language sql security invoker set search_path='' as $$ select private.requester_reopen_ticket(target,expected_revision,explanation,token) $$;
revoke all on function public.reopen_ticket(uuid,bigint,text,uuid) from public,anon,service_role;
grant execute on function public.reopen_ticket(uuid,bigint,text,uuid) to authenticated;

create or replace function private.restrict_employee_ticket_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='service_role' then
    if (private.current_automation_command(old.organization_id,old.id)).id is null then
      raise exception 'Validated automation command required' using errcode='42501';
    end if;
  elsif not (select private.can_work_tickets(old.organization_id)) then
    if old.requester_id is distinct from (select auth.uid()) or old.status not in ('resolved','closed') or new.status<>'open'
      or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
      raise exception 'Only a resolved or closed request may be reopened';
    end if;
  end if;
  if current_setting('role',true)<>'service_role' and not private.can_work_tickets(old.organization_id) and not exists(select 1 from private.ticket_reopen_receipts r where r.actor_id=auth.uid() and r.ticket_id=old.id and r.organization_id=old.organization_id and r.previous_revision=old.revision and r.request_transaction=pg_current_xact_id() and r.result_revision is null) then raise exception 'Use Reopen ticket and provide a reason' using errcode='42501'; end if;
  return new;
end $$;

create or replace function private.record_ticket_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare event_action text;
declare event_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    event_action := 'created';
    event_details := jsonb_build_object('status', new.status, 'priority', new.priority);
  elsif old.status is distinct from new.status then
    event_action := 'status_changed';
    event_details := jsonb_build_object('from', old.status, 'to', new.status);
    if old.status in ('resolved','closed') and new.status='open' then
      event_details:=event_details||coalesce((select jsonb_build_object('reason',r.reason) from private.ticket_reopen_receipts r where r.ticket_id=old.id and r.actor_id=auth.uid() and r.previous_revision=old.revision and r.request_transaction=pg_current_xact_id() and r.result_revision is null limit 1),'{}'::jsonb);
    end if;
  elsif old.assigned_technician_id is distinct from new.assigned_technician_id then
    event_action := 'assignment_changed';
    event_details := jsonb_build_object('from', old.assigned_technician_id, 'to', new.assigned_technician_id);
  elsif old.priority is distinct from new.priority then
    event_action := 'priority_changed';
    event_details := jsonb_build_object('from', old.priority, 'to', new.priority);
  elsif old.first_response_at is distinct from new.first_response_at then
    event_action := 'first_response_recorded';
  else
    event_action := 'details_updated';
  end if;
  insert into public.ticket_activity (organization_id, ticket_id, actor_id, action, details)
  values (new.organization_id, new.id, (select auth.uid()), event_action, event_details);
  return new;
end;
$$;

alter table private.notification_email_outbox add column reopen_reason text;
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
   if exists(select 1 from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id=new.assigned_technician_id and m.status='active' and m.role in ('technician','administrator')) then
     perform private.enqueue_notification(new.organization_id,new.assigned_technician_id,auth.uid(),new.id,null,event_kind,heading,true,'status:'||event);
   elsif event_kind='ticket_reopened' then
     for worker in select user_id from public.organization_memberships where organization_id=new.organization_id and status='active' and role in ('technician','administrator') loop
       perform private.enqueue_notification(new.organization_id,worker,auth.uid(),new.id,null,event_kind,heading,true,'status:'||event);
     end loop;
   end if;
   update private.notification_email_outbox q set
     previous_status=old.status,ticket_status=new.status,ticket_priority=new.priority,
     reopen_reason=case when event_kind='ticket_reopened' then (select r.reason from private.ticket_reopen_receipts r where r.ticket_id=old.id and r.actor_id=auth.uid() and r.previous_revision=old.revision and r.request_transaction=pg_current_xact_id() and r.result_revision is null limit 1) end,
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
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz,reopen_reason text)
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status,q.previous_status,q.status_changed_by,q.ticket_owner,q.reopen_reason
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||initcap(c.ticket_priority::text) end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,b.body,b.next_update_at,case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority,c.previous_status,c.status_changed_by,c.ticket_owner,n.created_at,c.reopen_reason
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id;
end;
$$;


revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
