create type public.chat_status as enum ('open', 'closed');
create type public.chat_message_kind as enum ('message', 'internal_note');

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null,
  assigned_technician_id uuid,
  topic text not null check (char_length(trim(topic)) between 3 and 180),
  status public.chat_status not null default 'open',
  ticket_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, ticket_id),
  foreign key (organization_id, requester_id) references public.organization_memberships(organization_id, user_id),
  foreign key (organization_id, assigned_technician_id) references public.organization_memberships(organization_id, user_id),
  foreign key (organization_id, ticket_id) references public.tickets(organization_id, id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  author_id uuid not null,
  kind public.chat_message_kind not null default 'message',
  body text not null check (char_length(trim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.chat_conversations(organization_id, id) on delete cascade,
  foreign key (organization_id, author_id) references public.organization_memberships(organization_id, user_id)
);

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  uploaded_by uuid not null,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.chat_conversations(organization_id, id) on delete cascade,
  foreign key (organization_id, uploaded_by) references public.organization_memberships(organization_id, user_id)
);

create index chat_conversations_queue_idx on public.chat_conversations (organization_id, status, updated_at desc);
create index chat_conversations_requester_idx on public.chat_conversations (organization_id, requester_id, updated_at desc);
create index chat_messages_conversation_idx on public.chat_messages (organization_id, conversation_id, created_at);
create index chat_attachments_conversation_idx on public.chat_attachments (organization_id, conversation_id, created_at);

create function private.can_view_chat(target_organization_id uuid, target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_conversations c
    where c.organization_id = target_organization_id and c.id = target_conversation_id
      and (select private.is_active_organization_member(target_organization_id))
      and (c.requester_id = (select auth.uid()) or (select private.can_work_tickets(target_organization_id)))
  );
$$;

create function private.can_view_chat_path(target_organization_id text, target_conversation_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target_organization_id ~* '^[0-9a-f-]{36}$' and target_conversation_id ~* '^[0-9a-f-]{36}$'
    then private.can_view_chat(target_organization_id::uuid, target_conversation_id::uuid) else false end;
$$;

create function private.can_use_chat_topic(target_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when target_topic ~* '^chat:[0-9a-f-]{36}$' then exists (
      select 1 from public.chat_conversations c
      where c.id = substring(target_topic from 6)::uuid
        and (select private.can_view_chat(c.organization_id, c.id))
    )
    when target_topic ~* '^chat-queue:[0-9a-f-]{36}$' then
      (select private.can_work_tickets(substring(target_topic from 12)::uuid))
    else false end;
$$;

revoke all on function private.can_view_chat(uuid, uuid), private.can_view_chat_path(text, text), private.can_use_chat_topic(text) from public, anon;
grant execute on function private.can_view_chat(uuid, uuid), private.can_view_chat_path(text, text), private.can_use_chat_topic(text) to authenticated;

create function private.prepare_chat_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ticket_id is not null and new.ticket_id is distinct from old.ticket_id then
    raise exception 'Linked ticket cannot be changed';
  end if;
  if new.ticket_id is not null and new.ticket_id is distinct from old.ticket_id and not exists (
    select 1 from public.tickets t where t.organization_id = new.organization_id
      and t.id = new.ticket_id and t.requester_id = new.requester_id
  ) then raise exception 'Ticket requester must match chat requester'; end if;
  if new.assigned_technician_id is not null and new.assigned_technician_id is distinct from old.assigned_technician_id and not exists (
    select 1 from public.organization_memberships m where m.organization_id = new.organization_id
      and m.user_id = new.assigned_technician_id and m.status = 'active' and m.role in ('technician', 'administrator')
  ) then raise exception 'Assignee must be an active technician'; end if;
  if old.status is distinct from new.status then new.closed_at := case when new.status = 'closed' then now() else null end; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger chat_prepare_change before update on public.chat_conversations
for each row execute function private.prepare_chat_change();

create function private.touch_chat_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_conversations set updated_at = new.created_at
  where organization_id = new.organization_id and id = new.conversation_id;
  return new;
end;
$$;
create trigger chat_message_touch after insert on public.chat_messages
for each row execute function private.touch_chat_on_message();
revoke all on function private.touch_chat_on_message() from public, anon, authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_attachments enable row level security;

create policy "Participants can read chats" on public.chat_conversations for select to authenticated
using ((select private.is_active_organization_member(organization_id)) and
  (requester_id = (select auth.uid()) or (select private.can_work_tickets(organization_id))));
create policy "Employees can start chats" on public.chat_conversations for insert to authenticated
with check ((select private.is_active_organization_member(organization_id)) and requester_id = (select auth.uid())
  and assigned_technician_id is null and ticket_id is null and status = 'open');
create policy "Technicians can manage chats" on public.chat_conversations for update to authenticated
using ((select private.can_work_tickets(organization_id)))
with check ((select private.can_work_tickets(organization_id)));

create policy "Participants can read chat messages" on public.chat_messages for select to authenticated
using ((select private.can_view_chat(organization_id, conversation_id)) and
  (kind = 'message' or (select private.can_work_tickets(organization_id))));
create policy "Participants can send chat messages" on public.chat_messages for insert to authenticated
with check (author_id = (select auth.uid()) and (select private.can_view_chat(organization_id, conversation_id))
  and (kind = 'message' or (select private.can_work_tickets(organization_id)))
  and exists (select 1 from public.chat_conversations c where c.organization_id = chat_messages.organization_id
    and c.id = chat_messages.conversation_id and c.status = 'open'));

create policy "Participants can read chat attachments" on public.chat_attachments for select to authenticated
using ((select private.can_view_chat(organization_id, conversation_id)));
create policy "Participants can add chat attachments" on public.chat_attachments for insert to authenticated
with check (uploaded_by = (select auth.uid()) and (select private.can_view_chat(organization_id, conversation_id))
  and exists (select 1 from public.chat_conversations c where c.organization_id = chat_attachments.organization_id
    and c.id = chat_attachments.conversation_id and c.status = 'open'));

revoke all on public.chat_conversations, public.chat_messages, public.chat_attachments from anon, authenticated;
grant select, insert on public.chat_conversations to authenticated;
grant update (assigned_technician_id, status, ticket_id) on public.chat_conversations to authenticated;
grant select, insert on public.chat_messages, public.chat_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "Participants can read chat files" on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments' and
  (select private.can_view_chat_path((storage.foldername(name))[1], (storage.foldername(name))[2])));
create policy "Participants can upload chat files" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[3] = (select auth.uid())::text
  and (select private.can_view_chat_path((storage.foldername(name))[1], (storage.foldername(name))[2])));
create policy "Uploaders can remove chat files" on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments' and (storage.foldername(name))[3] = (select auth.uid())::text
  and (select private.can_view_chat_path((storage.foldername(name))[1], (storage.foldername(name))[2])));

create policy "Chat participants can receive live state" on realtime.messages for select to authenticated
using (extension in ('presence', 'broadcast') and (select private.can_use_chat_topic((select realtime.topic()))));
create policy "Chat participants can send live state" on realtime.messages for insert to authenticated
with check (extension in ('presence', 'broadcast') and (select private.can_use_chat_topic((select realtime.topic()))));

alter publication supabase_realtime add table public.chat_conversations, public.chat_messages, public.chat_attachments;

create function public.start_support_chat(target_organization_id uuid, chat_topic text, first_message text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_chat_id uuid;
begin
  insert into public.chat_conversations (organization_id, requester_id, topic)
  values (target_organization_id, (select auth.uid()), trim(chat_topic)) returning id into new_chat_id;
  insert into public.chat_messages (organization_id, conversation_id, author_id, body)
  values (target_organization_id, new_chat_id, (select auth.uid()), trim(first_message));
  return new_chat_id;
end;
$$;
revoke all on function public.start_support_chat(uuid, text, text) from public, anon;
grant execute on function public.start_support_chat(uuid, text, text) to authenticated;

create function public.convert_chat_to_ticket(conversation_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare c public.chat_conversations%rowtype; new_ticket_id uuid; first_message text;
begin
  select * into c from public.chat_conversations where id = conversation_id for update;
  if not found or not (select private.can_work_tickets(c.organization_id)) then raise exception 'Chat not found or access denied'; end if;
  if c.ticket_id is not null then return c.ticket_id; end if;
  select body into first_message from public.chat_messages
    where organization_id = c.organization_id and public.chat_messages.conversation_id = c.id
      and kind = 'message' order by created_at, id limit 1;
  insert into public.tickets (organization_id, requester_id, assigned_technician_id, title, description, status)
  values (c.organization_id, c.requester_id, c.assigned_technician_id, c.topic,
    coalesce(first_message, 'Support chat converted to a ticket.'), 'open') returning id into new_ticket_id;
  update public.chat_conversations set ticket_id = new_ticket_id where id = c.id;
  return new_ticket_id;
end;
$$;
revoke all on function public.convert_chat_to_ticket(uuid) from public, anon;
grant execute on function public.convert_chat_to_ticket(uuid) to authenticated;

create function public.link_chat_to_ticket(conversation_id uuid, target_ticket_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare c public.chat_conversations%rowtype; t public.tickets%rowtype;
begin
  select * into c from public.chat_conversations where id = conversation_id for update;
  if not found or not (select private.can_work_tickets(c.organization_id)) then raise exception 'Chat not found or access denied'; end if;
  if c.ticket_id is not null then raise exception 'Chat is already linked to a ticket'; end if;
  select * into t from public.tickets where id = target_ticket_id and organization_id = c.organization_id;
  if not found or t.requester_id <> c.requester_id then raise exception 'Ticket requester must match chat requester'; end if;
  update public.chat_conversations set ticket_id = t.id where id = c.id;
  return t.id;
end;
$$;
revoke all on function public.link_chat_to_ticket(uuid, uuid) from public, anon;
grant execute on function public.link_chat_to_ticket(uuid, uuid) to authenticated;
