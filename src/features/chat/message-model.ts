import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';

export type RoomMessage = {
  id: string;
  author_id: string;
  kind: 'message' | 'internal_note';
  body: string;
  created_at: string;
  revision?: number;
  edited_at?: string | null;
};

/** Keep live edits when a route response was started before the edit committed. */
export function mergeChatMessages(...sources: RoomMessage[][]): RoomMessage[] {
  const messages = new Map<string, RoomMessage>();
  for (const message of sources.flat()) {
    const previous = messages.get(message.id);
    if (!previous || (message.revision ?? 1) >= (previous.revision ?? 1))
      messages.set(message.id, message);
  }
  return [...messages.values()];
}

export function parseChatMessage(
  value: unknown,
  organizationId: string,
  conversationId: string,
  worker: boolean,
): RoomMessage | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    row.organization_id !== organizationId ||
    row.conversation_id !== conversationId ||
    (row.kind !== 'message' && row.kind !== 'internal_note') ||
    (!worker && row.kind === 'internal_note') ||
    typeof row.id !== 'string' ||
    typeof row.author_id !== 'string' ||
    typeof row.body !== 'string' ||
    typeof row.created_at !== 'string' ||
    !Number.isFinite(Date.parse(row.created_at))
  )
    return null;
  return {
    id: row.id,
    author_id: row.author_id,
    kind: row.kind,
    body: row.body,
    created_at: row.created_at,
    revision: typeof row.revision === 'number' ? row.revision : 1,
    edited_at: typeof row.edited_at === 'string' ? row.edited_at : null,
  };
}

export type RoomAttachment = {
  id: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  storage_path: string;
  content_type?: string;
  uploaded_by?: string;
  url?: string;
};

export type ChatTimelineEntry = { key: string; created_at: string } & (
  { type: 'message'; message: RoomMessage } | { type: 'file'; file: RoomAttachment }
);

export function buildChatTimeline({
  liveMessages,
  initialMessages,
  outgoing,
  liveAttachments,
  initialAttachments,
}: {
  liveMessages: RoomMessage[];
  initialMessages: RoomMessage[];
  outgoing: RoomMessage | null;
  liveAttachments: RoomAttachment[];
  initialAttachments: RoomAttachment[];
}) {
  const confirmed = new Map(
    mergeChatMessages(liveMessages, initialMessages).map((message) => [message.id, message]),
  );
  const messages = [...confirmed.values()]
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .slice(-HISTORY_PAGE_SIZE);
  if (outgoing && !confirmed.has(outgoing.id)) messages.push(outgoing);
  const files = new Map(liveAttachments.map((file) => [file.id, file]));
  for (const file of initialAttachments) files.set(file.id, file);
  const attachments = [...files.values()]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    .slice(-HISTORY_PAGE_SIZE);
  const timeline: ChatTimelineEntry[] = [
    ...messages.map((message) => ({
      type: 'message' as const,
      key: `message:${message.id}`,
      created_at: message.created_at,
      message,
    })),
    ...attachments.map((file) => ({
      type: 'file' as const,
      key: `file:${file.id}`,
      created_at: file.created_at,
      file,
    })),
  ].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.key.localeCompare(b.key),
  );
  return { confirmed, messages, attachments, timeline };
}
