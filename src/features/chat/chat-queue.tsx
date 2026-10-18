import type { ReactNode } from 'react';
import { ChatTime } from './chat-time';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { CHAT_INBOX_LIMIT, chatConversationHref, chatInboxHref, type InboxChat } from './inbox-model';

const views: Record<string, { title: string; empty: string; hint: string }> = {
  open: { title: 'Open conversations', empty: 'Ready for the next conversation', hint: 'New messages to IT will appear here. Start a chat if you need support yourself.' },
  unassigned: { title: 'Waiting for an owner', empty: 'No chats waiting for an owner', hint: 'New unassigned conversations will appear here so your team can pick them up.' },
  mine: { title: 'Assigned to you', empty: 'You have no assigned chats', hint: 'Check unassigned conversations to find the next person who needs your help.' },
  all: { title: 'Conversation history', empty: 'No conversations yet', hint: 'Open and closed conversations will stay here so you can return to them later.' },
  personal: { title: 'Your conversations', empty: 'No chats yet', hint: 'Start a chat to send your first message to IT.' },
};

export function ChatQueue({ chats, names, view, failed, selectedId, viewerId, personal = false, connection, filters }: {
  chats: InboxChat[]; names: Map<string, string>; view: string; failed: boolean;
  selectedId?: string; viewerId?: string; personal?: boolean; connection?: ReactNode; filters?: ReactNode;
}) {
  const context = views[view] ?? views.open;
  return <>
    <header className="chat-inbox-heading"><div><h2 id="chat-inbox-title">{context.title}</h2>{!failed && <span>{chats.length === CHAT_INBOX_LIMIT ? 'Latest 100 conversations' : `${chats.length} conversation${chats.length === 1 ? '' : 's'}`}</span>}</div>{connection}</header>
    {filters && <div className="chat-inbox-toolbar">{filters}</div>}
    {failed ? <div className="empty-state" role="alert"><strong>Chats couldn’t be loaded</strong><p>Please try again. Your conversations haven’t been changed.</p><Link className="button button-secondary" href={selectedId ? chatConversationHref(selectedId, view) : chatInboxHref(view)}>Try again</Link></div>
      : chats.length ? <ul className="chat-conversation-list">{chats.map(chat => {
        const person = personal ? 'IT support' : names.get(chat.requester_id) ?? 'Employee';
        return <li key={chat.id}><Link className="chat-conversation-link" href={chatConversationHref(chat.id, view === 'personal' ? 'open' : view)} scroll={false} aria-current={selectedId === chat.id ? 'page' : undefined} aria-label={`Open chat: ${chat.topic}${chat.unread ? `, ${chat.unread} unread update${chat.unread === 1 ? '' : 's'}` : ''}`}>
          <Avatar name={person} size="small"/>
          <div className="chat-conversation-copy"><div className="chat-conversation-top"><strong>{person}</strong><ChatTime value={chat.updated_at} variant="inbox"/></div>
            <h3>{chat.topic}</h3><p className="chat-conversation-preview">{chat.preview ? `${chat.preview.author_id === viewerId ? 'You: ' : ''}${chat.preview.body}` : 'No messages yet.'}</p>
            <div className="chat-conversation-meta"><span className={`ticket-badge tone-${chat.status === 'open' ? 'blue' : 'slate'}`}>{chat.status === 'open' ? 'Open' : 'Closed'}</span>{!personal && <span>{chat.assigned_technician_id ? `Assigned to ${names.get(chat.assigned_technician_id) ?? 'a technician'}` : 'Unassigned'}</span>}{chat.ticket_id && <span className="sr-only">Linked to a ticket</span>}{Boolean(chat.unread) && <span className="chat-unread-count" aria-hidden="true">{chat.unread! > 99 ? '99+' : chat.unread}</span>}</div>
          </div>
        </Link></li>;
      })}</ul>
      : <div className="empty-state chat-inbox-empty"><span className="chat-intake-icon"><NavigationIcon name="chat"/></span><strong>{context.empty}</strong><p>{context.hint}</p><Link className="button button-secondary" href={view === 'mine' ? '/app/chat?view=unassigned' : view === 'unassigned' ? '/app/chat' : '/app/chat?start=1'}>{view === 'mine' ? 'View unassigned chats' : view === 'unassigned' ? 'View open chats' : 'Start a chat'}</Link></div>}
  </>;
}
