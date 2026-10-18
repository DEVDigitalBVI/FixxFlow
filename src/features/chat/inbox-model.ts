export const CHAT_INBOX_LIMIT = 100;
export type ChatView = 'open' | 'unassigned' | 'mine' | 'all';
export const chatViews: { value: ChatView; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'mine', label: 'Mine' },
  { value: 'all', label: 'History' },
];
export const normalizeChatView = (value?: string): ChatView => chatViews.some(view => view.value === value) ? value as ChatView : 'open';
export function chatInboxHref(view: string = 'open') {
  return view === 'open' ? '/app/chat' : `/app/chat?view=${normalizeChatView(view)}`;
}
export function chatConversationHref(id: string, view: string = 'open') {
  return `/app/chat/${encodeURIComponent(id)}${view === 'open' ? '' : `?view=${normalizeChatView(view)}`}`;
}
export type InboxChat = {
  id: string; topic: string; requester_id: string; assigned_technician_id: string | null;
  status: string; ticket_id: string | null; updated_at: string;
  preview?: { body: string; author_id: string } | null;
  unread?: number;
};
