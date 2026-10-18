-- Extend only chat uploads; keep the bucket private and the existing 10 MB limit.
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf','text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4','video/webm','video/quicktime',
  'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm','audio/ogg'
] where id = 'chat-attachments';

-- Files are public to conversation participants, including when composing a staff note.
create function private.notify_chat_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare chat public.chat_conversations%rowtype; worker uuid;
begin
  select * into chat from public.chat_conversations
  where id = new.conversation_id and organization_id = new.organization_id;
  if new.uploaded_by = chat.requester_id then
    for worker in select user_id from public.organization_memberships
      where organization_id = new.organization_id and status = 'active'
        and role in ('technician','administrator')
        and (chat.assigned_technician_id is null or user_id = chat.assigned_technician_id)
    loop
      perform private.enqueue_notification(new.organization_id,worker,new.uploaded_by,null,chat.id,
        'user_replied','New attachment in support chat',true,'chat-attachment:'||new.id);
    end loop;
  else
    perform private.enqueue_notification(new.organization_id,chat.requester_id,new.uploaded_by,null,chat.id,
      'chat_response','New attachment in support chat',false,'chat-attachment:'||new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_chat_attachment() from public, anon, authenticated;
create trigger chat_attachment_notify after insert on public.chat_attachments
for each row execute function private.notify_chat_attachment();
create trigger chat_attachment_touch after insert on public.chat_attachments
for each row execute function private.touch_chat_on_message();
