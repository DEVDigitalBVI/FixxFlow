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
