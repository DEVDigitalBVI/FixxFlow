alter table public.chat_messages
  add column revision integer not null default 1,
  add column edited_at timestamptz;

-- Clients can change text only. Identity, audience, timestamps and revisions stay server-owned.
grant update (body) on public.chat_messages to authenticated;
create policy "Authors can edit their own open chat messages" on public.chat_messages
for update to authenticated
using (
  author_id = (select auth.uid())
  and (select private.can_view_chat(organization_id, conversation_id))
  and (kind = 'message' or (select private.can_work_tickets(organization_id)))
  and exists (select 1 from public.chat_conversations c where c.organization_id = chat_messages.organization_id
    and c.id = chat_messages.conversation_id and c.status = 'open')
)
with check (
  author_id = (select auth.uid())
  and (select private.can_view_chat(organization_id, conversation_id))
  and (kind = 'message' or (select private.can_work_tickets(organization_id)))
  and exists (select 1 from public.chat_conversations c where c.organization_id = chat_messages.organization_id
    and c.id = chat_messages.conversation_id and c.status = 'open')
);

create function private.stamp_chat_message_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    new.revision := old.revision + 1;
    new.edited_at := clock_timestamp();
  else
    new.revision := old.revision;
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_chat_message_edit() from public, anon, authenticated;
create trigger chat_message_edit_stamp before update on public.chat_messages
for each row execute function private.stamp_chat_message_edit();

-- Runs with the caller's grants and RLS. Stale revisions return no rows rather than overwriting newer text.
create function public.edit_chat_message(org uuid, conversation uuid, message uuid, expected_revision integer, new_body text)
returns setof public.chat_messages language plpgsql security invoker set search_path = '' as $$
begin
  if length(trim(new_body)) not between 1 and 20000 or new_body is null then
    raise exception 'Enter a message of up to 20,000 characters.' using errcode = '22023';
  end if;
  return query update public.chat_messages m set body = trim(new_body)
    where m.organization_id = org and m.conversation_id = conversation and m.id = message
      and m.author_id = (select auth.uid()) and m.revision = expected_revision
    returning m.*;
end;
$$;
revoke all on function public.edit_chat_message(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.edit_chat_message(uuid, uuid, uuid, integer, text) to authenticated;
