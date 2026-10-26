/** Reusable reply text shared by a workspace's IT staff. */
export type SavedReply = { id: string; title: string; body: string };

export type SavedReplyContext = {
  requesterName?: string | null;
  agentName?: string | null;
  ticketNumber?: number | null;
};

export const SAVED_REPLY_TITLE_LIMIT = 120;
export const SAVED_REPLY_BODY_LIMIT = 10000;

export const savedReplyPlaceholders = [
  { token: '{{requester_first_name}}', description: 'Requester first name' },
  { token: '{{requester_name}}', description: 'Requester full name' },
  { token: '{{ticket_number}}', description: 'Ticket number, such as #1042' },
  { token: '{{agent_first_name}}', description: 'Your first name' },
  { token: '{{agent_name}}', description: 'Your full name' },
] as const;

const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || null;

/**
 * Fills known placeholders. Unknown placeholders, and known ones without a value
 * here (for example a chat with no ticket number), stay visible so staff notice
 * and edit them before sending.
 */
export function renderSavedReply(body: string, context: SavedReplyContext): string {
  const values: Record<string, string | null> = {
    requester_first_name: firstName(context.requesterName),
    requester_name: context.requesterName?.trim() || null,
    ticket_number: context.ticketNumber ? `#${context.ticketNumber}` : null,
    agent_first_name: firstName(context.agentName),
    agent_name: context.agentName?.trim() || null,
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}

/** Inserts reply text at the caret, separating it from existing draft text. */
export function insertIntoDraft(draft: string, text: string, start: number, end: number) {
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const trail = after && !after.startsWith('\n') ? '\n' : '';
  const value = `${before}${lead}${text}${trail}${after}`;
  return { value, caret: before.length + lead.length + text.length };
}

export function validateSavedReply(title: string, body: string): string | null {
  const name = title.trim();
  if (name.length < 2 || name.length > SAVED_REPLY_TITLE_LIMIT)
    return `Enter a title between 2 and ${SAVED_REPLY_TITLE_LIMIT} characters.`;
  if (!body.trim() || body.length > SAVED_REPLY_BODY_LIMIT)
    return `Enter reply text up to ${SAVED_REPLY_BODY_LIMIT.toLocaleString('en')} characters.`;
  return null;
}
