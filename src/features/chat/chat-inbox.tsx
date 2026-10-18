import Link from 'next/link';
import { ChatQueue } from './chat-queue';
import { LiveChatQueue } from './live-queue';
import { chatConversationHref, chatInboxHref, chatViews, type ChatView, type InboxChat } from './inbox-model';

export function ChatInbox({ chats, names, failed, view, organizationId, viewerId, personal = false, selectedId }: {
  chats: InboxChat[]; names: Map<string, string>; failed: boolean; view: ChatView;
  organizationId: string; viewerId: string; personal?: boolean; selectedId?: string;
}) {
  return <section className="chat-inbox" aria-labelledby="chat-inbox-title">
    <div className="chat-inbox-toolbar"><div className="chat-inbox-label"><strong>Inbox</strong><LiveChatQueue organizationId={organizationId} viewerId={viewerId} personal={personal}/></div>
      {!personal && <nav className="queue-views" aria-label="Chat views">{chatViews.map(item => <Link key={item.value} href={selectedId ? chatConversationHref(selectedId, item.value) : chatInboxHref(item.value)} aria-current={view === item.value ? 'page' : undefined}>{item.label}</Link>)}</nav>}
    </div>
    {selectedId && !failed && !chats.some(chat => chat.id === selectedId) && <p className="chat-outside-view">The current conversation is outside this inbox view.</p>}
    <ChatQueue chats={chats} names={names} view={personal ? 'personal' : view} failed={failed} selectedId={selectedId} viewerId={viewerId} personal={personal}/>
  </section>;
}
