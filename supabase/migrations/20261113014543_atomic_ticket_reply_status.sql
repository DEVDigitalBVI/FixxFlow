-- Caller-permission ticket/message writes, with immutable receipts for lost responses.
begin;
create table private.ticket_reply_status_receipts (
 message_id uuid primary key references public.ticket_messages(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 ticket_id uuid not null references public.tickets(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 body_sha256 text not null,
 requested_status public.ticket_status not null check(requested_status in ('waiting_on_user','resolved')),
 expected_revision bigint not null check(expected_revision>0),
 result_revision bigint not null check(result_revision>expected_revision),
 created_at timestamptz not null default now()
);
alter table private.ticket_reply_status_receipts enable row level security;
revoke all on private.ticket_reply_status_receipts from public,anon,authenticated,service_role;
grant select,insert on private.ticket_reply_status_receipts to authenticated;
create policy own_worker_reply_receipts on private.ticket_reply_status_receipts for all to authenticated
 using(actor_id=(select auth.uid()) and private.can_work_tickets(organization_id))
 with check(actor_id=(select auth.uid()) and private.can_work_tickets(organization_id));
create policy reply_receipts_assurance on private.ticket_reply_status_receipts as restrictive for all to authenticated
 using((select private.has_required_assurance())) with check((select private.has_required_assurance()));
create index ticket_reply_status_receipts_ticket_idx on private.ticket_reply_status_receipts(ticket_id);
create index ticket_reply_status_receipts_org_idx on private.ticket_reply_status_receipts(organization_id);
create index ticket_reply_status_receipts_actor_idx on private.ticket_reply_status_receipts(actor_id);

-- This trigger can only attest writes made by the same worker in this transaction.
-- It cannot mutate tickets/messages or elevate their caller's RLS permissions.
create function private.confirm_ticket_reply_status() returns trigger
language plpgsql security definer set search_path='' as $$
declare ticket public.tickets; message public.ticket_messages;
 transaction_id xid:=((pg_current_xact_id()::text::bigint % 4294967296)::text)::xid;
begin
 if auth.uid() is distinct from new.actor_id or private.can_work_tickets(new.organization_id) is not true
   or private.has_required_assurance() is not true then
   raise exception 'Reply access denied' using errcode='42501';
 end if;
 select t.* into ticket from public.tickets t where t.organization_id=new.organization_id and t.id=new.ticket_id and t.xmin=transaction_id;
 if not found or ticket.revision<>new.result_revision or ticket.status<>new.requested_status then
   raise exception 'Reply status receipt does not match the ticket write' using errcode='22023';
 end if;
 select m.* into message from public.ticket_messages m where m.id=new.message_id and m.xmin=transaction_id;
 if not found or message.organization_id<>new.organization_id or message.ticket_id<>new.ticket_id
   or message.author_id is distinct from new.actor_id or message.kind<>'reply'
   or encode(sha256(convert_to(message.body,'UTF8')),'hex')<>new.body_sha256 then
   raise exception 'Reply status receipt does not match the public reply' using errcode='22023';
 end if;
 -- Waiting does not produce a separate status notification. Enrich only this
 -- requester's exact reply email; staff copies and resolution emails stay intact.
 if new.requested_status='waiting_on_user' then
   update private.notification_email_outbox q set ticket_status='waiting_on_user'
   from public.notifications n where n.id=q.notification_id
    and n.organization_id=new.organization_id and n.ticket_id=new.ticket_id
    and n.recipient_id=ticket.requester_id and not n.staff_only and n.kind='ticket_response'
    and n.event_key='ticket-message:'||new.message_id::text
    and q.status='pending' and q.attempts=0 and q.first_attempt_at is null;
 end if;
 return new;
end $$;
revoke all on function private.confirm_ticket_reply_status() from public,anon,authenticated,service_role;
create trigger ticket_reply_status_confirm before insert on private.ticket_reply_status_receipts
 for each row execute function private.confirm_ticket_reply_status();

create function public.reply_and_set_ticket_status(
 ticket_id uuid,message_id uuid,body text,status public.ticket_status,expected_revision bigint
) returns table(message_sent boolean,status_changed boolean,revision bigint,already_sent boolean)
language plpgsql security invoker set search_path='' as $$
declare ticket public.tickets; message public.ticket_messages; receipt private.ticket_reply_status_receipts;
 actor uuid:=auth.uid(); reply text:=btrim(body,E' \t\r\n'); result bigint; digest text;
begin
 if actor is null or private.has_required_assurance() is not true then
   raise exception 'Reply access denied' using errcode='42501';
 end if;
 if ticket_id is null or message_id is null or reply is null or char_length(reply) not between 1 and 20000
   or status is null or status not in ('waiting_on_user','resolved') or expected_revision is null or expected_revision<1 then
   raise exception 'Choose a public reply action with a valid message and revision' using errcode='22023';
 end if;
 -- Serialize message IDs as well as ticket writes, including reuse across tickets.
 perform pg_advisory_xact_lock(hashtextextended(message_id::text,0));
 select t.* into ticket from public.tickets t where t.id=reply_and_set_ticket_status.ticket_id for update;
 if not found or private.can_work_tickets(ticket.organization_id) is not true then
   raise exception 'Reply access denied' using errcode='42501';
 end if;
 digest:=encode(sha256(convert_to(reply,'UTF8')),'hex');
 -- A committed retry must be recognized BEFORE checking the now-advanced revision.
 select m.* into message from public.ticket_messages m where m.id=reply_and_set_ticket_status.message_id;
 if found then
   if message.organization_id<>ticket.organization_id or message.ticket_id<>ticket.id
     or message.author_id is distinct from actor or message.kind<>'reply' or message.body<>reply then
     raise exception 'Message ID was already used with different details' using errcode='PT422';
   end if;
   select r.* into receipt from private.ticket_reply_status_receipts r where r.message_id=message.id;
   if found then
     if receipt.requested_status<>status or receipt.expected_revision<>expected_revision or receipt.body_sha256<>digest then
       raise exception 'Reply action was already used with different details' using errcode='PT422';
     end if;
     return query select true,true,receipt.result_revision,true;
   else
     -- A legacy/plain reply is confirmed, but no atomic status result can be claimed.
     return query select true,false,ticket.revision,true;
   end if;
   return;
 end if;
 if ticket.revision<>expected_revision then
   raise exception 'Ticket changed; review the latest ticket before sending' using errcode='PT409';
 end if;
 if ticket.status in ('resolved','closed') then
   raise exception 'Reopen the ticket using Status before sending a reply with a status change' using errcode='22023';
 end if;
 insert into public.ticket_messages(id,organization_id,ticket_id,author_id,kind,body)
 values(message_id,ticket.organization_id,ticket.id,actor,'reply',reply);
 -- The row lock is still held. Reply acknowledgment may advance its revision;
 -- that is our own write, not another worker's change. All existing triggers run.
 update public.tickets t set status=reply_and_set_ticket_status.status where t.id=ticket.id
 returning t.revision into result;
 if not found then raise exception 'Ticket update denied' using errcode='42501'; end if;
 insert into private.ticket_reply_status_receipts(message_id,organization_id,ticket_id,actor_id,body_sha256,requested_status,expected_revision,result_revision)
 values(message_id,ticket.organization_id,ticket.id,actor,digest,status,expected_revision,result);
 return query select true,true,result,false;
end $$;
revoke all on function public.reply_and_set_ticket_status(uuid,uuid,text,public.ticket_status,bigint) from public,anon,service_role;
grant execute on function public.reply_and_set_ticket_status(uuid,uuid,text,public.ticket_status,bigint) to authenticated;
commit;
