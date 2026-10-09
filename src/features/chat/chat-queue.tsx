import { Timestamp } from '@/features/timezones/provider';
import Link from 'next/link';
import { NavigationIcon } from '@/components/navigation/navigation-icon';

type Chat = { id: string; topic: string; requester_id: string; assigned_technician_id: string | null; status: string; ticket_id: string | null; updated_at: string };
const views: Record<string, { title: string; empty: string; hint: string }> = {
  open: { title: 'Open conversations', empty: 'Ready for the next conversation', hint: 'New messages to IT will appear here. Start a chat if you need support yourself.' },
  unassigned: { title: 'Waiting for an owner', empty: 'No chats waiting for an owner', hint: 'New unassigned conversations will appear here so your team can pick them up.' },
  mine: { title: 'Assigned to you', empty: 'You have no assigned chats', hint: 'Check unassigned conversations to find the next person who needs your help.' },
  all: { title: 'Conversation history', empty: 'No conversations yet', hint: 'Open and closed conversations will stay here so you can return to them later.' },
};

export function ChatQueue({ chats, names, view, failed }: { chats: Chat[]; names: Map<string, string>; view: string; failed: boolean }) {
  const context = views[view] ?? views.open;
  return <>
    <header className="chat-inbox-heading"><h2 id="chat-inbox-title">{context.title}</h2>{!failed && <span>{chats.length === 100 ? 'Latest 100 conversations' : `${chats.length} conversation${chats.length === 1 ? '' : 's'}`}</span>}</header>
    {failed ? <div className="empty-state" role="alert"><strong>Chats couldn’t be loaded</strong><p>Please try again. Your conversations haven’t been changed.</p><Link className="button button-secondary" href={view === 'open' ? '/app/chat' : `/app/chat?view=${view}`}>Try again</Link></div>
      : chats.length ? <ul className="chat-inbox-list">{chats.map(chat => <li key={chat.id}>
        <span className="chat-requester-avatar" aria-hidden="true">{(names.get(chat.requester_id) ?? 'Employee').trim().slice(0, 1).toLocaleUpperCase()}</span>
        <div className="chat-inbox-topic"><h3>{chat.topic}</h3><p>{names.get(chat.requester_id) ?? 'Employee'} <span>· Updated <time dateTime={chat.updated_at}><Timestamp value={chat.updated_at}/></time></span></p>
          <div className="chat-inbox-meta"><span>{chat.assigned_technician_id ? `Assigned to ${names.get(chat.assigned_technician_id) ?? 'a technician'}` : 'No technician assigned'}</span>{chat.ticket_id && <span>Linked to a ticket</span>}</div>
        </div>
        <div className="chat-inbox-actions"><span className={`ticket-badge tone-${chat.status === 'open' ? 'blue' : 'slate'}`}>{chat.status === 'open' ? 'Open' : 'Closed'}</span><Link className="button button-secondary" href={`/app/chat/${chat.id}`} aria-label={`Open chat: ${chat.topic}`}>Open chat</Link></div>
      </li>)}</ul>
      : <div className="empty-state chat-inbox-empty"><span className="chat-intake-icon"><NavigationIcon name="chat"/></span><strong>{context.empty}</strong><p>{context.hint}</p><Link className="button button-secondary" href={view === 'mine' ? '/app/chat?view=unassigned' : view === 'unassigned' ? '/app/chat' : '/app/chat?start=1'}>{view === 'mine' ? 'View unassigned chats' : view === 'unassigned' ? 'View open chats' : 'Start a chat'}</Link></div>}
  </>;
}
