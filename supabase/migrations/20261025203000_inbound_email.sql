-- Email to ticket. Each workspace receives mail at <slug>@<inbound domain>; the
-- webhook (service role only) calls accept_inbound_email. Only active members whose
-- address passed DMARC can create tickets or reply. Every message is logged for the
-- workspace's administrators, including rejections.
create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_email_id text not null unique check(char_length(provider_email_id) between 1 and 200),
  sender text not null check(char_length(sender) <= 320),
  subject text not null default '' check(char_length(subject) <= 998),
  status text not null check(status in ('ticket_created','reply_added','note_added','rejected_sender','rejected_unauthenticated','rejected_ticket')),
  ticket_id uuid,
  created_at timestamptz not null default now(),
  foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete set null (ticket_id)
);
create index inbound_emails_org_time_idx on public.inbound_emails(organization_id,created_at desc,id desc);

alter table public.inbound_emails enable row level security;
create policy inbound_emails_admin_read on public.inbound_emails for select to authenticated
  using ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
create policy require_enrolled_mfa on public.inbound_emails as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.inbound_emails from public,anon,authenticated;
grant select on public.inbound_emails to authenticated;
grant all on public.inbound_emails to service_role;

-- Server code with the service role may not post as a member (guard_automation_note).
-- accept_inbound_email records a one-transaction context for the exact ticket and
-- author it verified; the guard allows a member message from the service role only
-- when that context exists. No role other than the function owner can write it.
create table private.inbound_message_contexts (
  transaction_id xid8 not null default pg_current_xact_id(),
  organization_id uuid not null,
  ticket_id uuid not null,
  author_id uuid not null,
  primary key(transaction_id,ticket_id)
);
revoke all on private.inbound_message_contexts from public,anon,authenticated,service_role;

-- Unchanged from 20261001023010 except the inbound-email context check.
create or replace function private.guard_automation_note() returns trigger language plpgsql security definer set search_path to '' as $function$
declare execution public.automation_executions; context private.automation_command_contexts;
begin
  if tg_op<>'INSERT' and old.author_type='automation' then
    raise exception 'Automation note receipt is immutable' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  if current_setting('role',true)='service_role' and new.author_type<>'automation'
    and not exists(select 1 from private.inbound_message_contexts c where c.transaction_id=pg_current_xact_id()
      and c.organization_id=new.organization_id and c.ticket_id=new.ticket_id and c.author_id=new.author_id) then
    raise exception 'Validated automation note required' using errcode='42501';
  end if;
  if new.author_type='automation' then
    execution:=private.current_automation_command(new.organization_id,new.ticket_id);
    select * into context from private.automation_command_contexts where transaction_id=pg_current_xact_id();
    if execution.id is null or new.automation_execution_id is distinct from execution.id or new.automation_step_id is distinct from context.step_id
      or new.automation_name is distinct from execution.rule_name or not exists(select 1 from public.automation_execution_steps where id=context.step_id and action_type='add_internal_note') then
      raise exception 'Invalid automation note authority' using errcode='42501';
    end if;
  end if;
  return new;
end $function$;

create function public.accept_inbound_email(
  provider_id text, org_slug text, sender_email text, subject text, body text,
  authenticated boolean, attachment_count integer default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  org uuid; member record; target public.tickets%rowtype; prior public.inbound_emails%rowtype;
  sender text := lower(trim(sender_email)); raw_subject text := left(coalesce(subject,''),998);
  referenced bigint; title text; content text; outcome text; ticket uuid; is_staff boolean;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  -- Idempotent: Resend may deliver a webhook more than once.
  select * into prior from public.inbound_emails where provider_email_id=provider_id;
  if found then return jsonb_build_object('status',prior.status,'ticket_id',prior.ticket_id,'duplicate',true); end if;
  select id into org from public.organizations where slug=lower(trim(org_slug));
  if org is null then return jsonb_build_object('status','rejected_recipient'); end if;

  content := nullif(left(trim(coalesce(body,'')),19000),'');
  content := coalesce(content,'(No message text)');
  if attachment_count>0 then
    content := content||E'\n\n[This email had '||attachment_count||' attachment'||case when attachment_count=1 then '' else 's' end
      ||'. Email attachments are not imported; ask the sender to upload files in FixxFlow.]';
  end if;

  if not coalesce(authenticated,false) then outcome:='rejected_unauthenticated';
  else
    select m.user_id, m.role into member from public.organization_memberships m
      join auth.users u on u.id=m.user_id
      where m.organization_id=org and m.status='active' and lower(u.email)=sender and u.email_confirmed_at is not null
      limit 1;
    if member.user_id is null then outcome:='rejected_sender'; end if;
  end if;

  if outcome is null then
    is_staff := member.role in ('technician','administrator');
    referenced := nullif(substring(raw_subject from '\[#([0-9]{1,12})\]'),'')::bigint;
    if referenced is not null then
      select * into target from public.tickets where organization_id=org and ticket_number=referenced;
    end if;
    if target.id is not null and not (target.requester_id=member.user_id or is_staff) then
      outcome:='rejected_ticket';   -- never reveal or touch someone else's ticket
    elsif target.id is not null and target.status<>'closed' then
      -- The requester replies publicly; staff email replies become internal notes so an
      -- email reply never exposes text to the requester by accident.
      insert into private.inbound_message_contexts(organization_id,ticket_id,author_id)
        values(org,target.id,member.user_id);
      insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body)
        values(org,target.id,member.user_id,
          case when target.requester_id=member.user_id then 'reply'::public.ticket_message_kind else 'internal_note'::public.ticket_message_kind end,
          content);
      delete from private.inbound_message_contexts where transaction_id=pg_current_xact_id() and ticket_id=target.id;
      outcome:=case when target.requester_id=member.user_id then 'reply_added' else 'note_added' end;
      ticket:=target.id;
    else
      title := trim(regexp_replace(regexp_replace(raw_subject,'\[#[0-9]{1,12}\]','','g'),'^\s*((re|fw|fwd)\s*:\s*)+','','i'));
      if target.id is not null then title:='Follow-up to #'||target.ticket_number||': '||coalesce(nullif(title,''),'Email request'); end if;
      title := left(coalesce(nullif(title,''),'Email request'),180);
      if char_length(title)<3 then title:='Email request'; end if;
      insert into public.tickets(organization_id,requester_id,title,description)
        values(org,member.user_id,title,content) returning id into ticket;
      outcome:='ticket_created';
    end if;
  end if;

  insert into public.inbound_emails(organization_id,provider_email_id,sender,subject,status,ticket_id)
    values(org,provider_id,left(sender,320),raw_subject,outcome,ticket);
  return jsonb_build_object('status',outcome,'ticket_id',ticket,'duplicate',false);
end $$;
revoke all on function public.accept_inbound_email(text,text,text,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.accept_inbound_email(text,text,text,text,text,boolean,integer) to service_role;
