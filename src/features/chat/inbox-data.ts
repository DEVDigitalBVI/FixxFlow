import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { profileLabels } from '@/features/lookups/labels';
import type { Database } from '@/types/database';

import { CHAT_INBOX_LIMIT, type ChatView, type InboxChat } from './inbox-model';

/** Left embeds keep empty chats visible; RLS also applies to previews and counts. */
export async function loadChatInbox(
  supabase: SupabaseClient<Database>,
  viewer: { id: string; organizationId: string; role: string },
  view: ChatView,
) {
  let query = supabase
    .from('chat_conversations')
    .select(
      'id, topic, requester_id, assigned_technician_id, status, ticket_id, updated_at, chat_messages(body, author_id, created_at), chat_attachments(file_name, uploaded_by, created_at), notifications(count)',
    )
    .eq('organization_id', viewer.organizationId)
    .eq('chat_messages.kind', 'message')
    .order('created_at', { ascending: false, referencedTable: 'chat_messages' })
    .order('id', { ascending: false, referencedTable: 'chat_messages' })
    .limit(1, { referencedTable: 'chat_messages' })
    .order('created_at', { ascending: false, referencedTable: 'chat_attachments' })
    .order('id', { ascending: false, referencedTable: 'chat_attachments' })
    .limit(1, { referencedTable: 'chat_attachments' })
    .eq('notifications.recipient_id', viewer.id)
    .is('notifications.read_at', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CHAT_INBOX_LIMIT);
  if (viewer.role === 'end_user') query = query.eq('requester_id', viewer.id);
  else if (view === 'unassigned')
    query = query.is('assigned_technician_id', null).eq('status', 'open');
  else if (view === 'mine')
    query = query.eq('assigned_technician_id', viewer.id).eq('status', 'open');
  else if (view !== 'all') query = query.eq('status', 'open');
  const { data, error } = await query;
  const chats: InboxChat[] = error
    ? []
    : (data ?? []).map((chat) => {
        const message = chat.chat_messages?.[0],
          file = chat.chat_attachments?.[0];
        const preview =
          file && (!message || Date.parse(file.created_at) >= Date.parse(message.created_at))
            ? { body: `Attachment: ${file.file_name}`, author_id: file.uploaded_by }
            : (message ?? null);
        return { ...chat, preview, unread: chat.notifications?.[0]?.count ?? 0 };
      });
  const profiles =
    viewer.role === 'end_user' || !chats.length
      ? []
      : await profileLabels(
          supabase,
          viewer.organizationId,
          chats.flatMap((chat) => [chat.requester_id, chat.assigned_technician_id]),
        );
  return {
    chats,
    names: new Map(profiles.map((profile) => [profile.user_id, profile.display_name])),
    failed: Boolean(error),
  };
}
