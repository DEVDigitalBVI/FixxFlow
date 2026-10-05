begin;

-- Factor status is read from Auth, never from user-editable JWT metadata.
create function private.has_required_assurance()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    coalesce((select auth.jwt()->>'aal') = 'aal2', false)
    or not exists (select 1 from auth.mfa_factors
      where user_id = (select auth.uid()) and status = 'verified')
  );
$$;
revoke all on function private.has_required_assurance() from public, anon;
grant execute on function private.has_required_assurance() to authenticated;

-- Restrictive policies AND with existing tenant/role rules, including direct APIs.
do $$
declare target text;
begin
  foreach target in array array[
    'public.organizations', 'public.organization_memberships', 'public.profiles',
    'public.departments', 'public.locations', 'public.teams',
    'public.ticket_categories', 'public.ticket_subcategories', 'public.tickets',
    'public.ticket_messages', 'public.ticket_attachments', 'public.ticket_activity',
    'public.chat_conversations', 'public.chat_messages', 'public.chat_attachments',
    'storage.objects', 'realtime.messages'
  ] loop
    execute format('create policy require_enrolled_mfa on %s as restrictive for all to authenticated
      using ((select private.has_required_assurance()))
      with check ((select private.has_required_assurance()))', target);
  end loop;
end;
$$;

-- Callers own message content and routing, not chronology or SLA completion.
revoke insert on public.tickets, public.ticket_messages, public.ticket_attachments,
  public.chat_conversations, public.chat_messages, public.chat_attachments from authenticated;
grant insert (id, organization_id, requester_id, title, description, assigned_technician_id,
  team_id, category_id, subcategory_id, priority, status, location_id, due_at) on public.tickets to authenticated;
grant insert (id, organization_id, ticket_id, author_id, kind, body) on public.ticket_messages to authenticated;
grant insert (id, organization_id, ticket_id, uploaded_by, storage_path, file_name, content_type, size_bytes)
  on public.ticket_attachments to authenticated;
grant insert (id, organization_id, requester_id, assigned_technician_id, topic, status, ticket_id)
  on public.chat_conversations to authenticated;
grant insert (id, organization_id, conversation_id, author_id, kind, body) on public.chat_messages to authenticated;
grant insert (id, organization_id, conversation_id, uploaded_by, storage_path, file_name, content_type, size_bytes)
  on public.chat_attachments to authenticated;

-- Serialize administrator removals so concurrent requests cannot remove the last two.
create or replace function private.protect_last_administrator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'administrator' and old.status = 'active'
    and (new.role <> 'administrator' or new.status <> 'active') then
    perform 1 from public.organizations where id = old.organization_id for update;
    if not exists (select 1 from public.organization_memberships
      where organization_id = old.organization_id and user_id <> old.user_id
        and role = 'administrator' and status = 'active') then
      raise exception 'An organization must retain at least one active administrator';
    end if;
  end if;
  return new;
end;
$$;

create index chat_attachments_uploader_idx on public.chat_attachments (organization_id, uploaded_by);
create index chat_conversations_assignee_idx on public.chat_conversations (organization_id, assigned_technician_id);
create index chat_messages_author_idx on public.chat_messages (organization_id, author_id);

commit;
