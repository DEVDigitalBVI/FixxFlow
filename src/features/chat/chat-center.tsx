import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { NavigationIcon } from '@/components/navigation/navigation-icon';

export function ChatCenter({ inbox, children, personal = false }: { inbox: ReactNode; children?: ReactNode; personal?: boolean }) {
  return <div className={`page chat-center-page${personal ? ' chat-center-personal' : ''}`}>
    <PageHeader title={personal ? 'My chats' : 'Live chat'} className="chat-center-heading" actions={<Link className="button button-secondary" href="/app/chat?start=1">New chat</Link>}/>
    <div className={`chat-center${children ? ' chat-center-selected' : ''}`}>
      <div className="chat-center-inbox">{inbox}</div>
      {children ?? <section className="chat-center-welcome" aria-labelledby="chat-welcome-title"><span className="chat-intake-icon"><NavigationIcon name="chat"/></span><h2 id="chat-welcome-title">Select a conversation</h2><p>Choose a chat from the inbox to read messages and reply{personal ? ' to IT.' : '.'}</p></section>}
    </div>
  </div>;
}
