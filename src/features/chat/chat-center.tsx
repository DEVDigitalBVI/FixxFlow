import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { NavigationIcon } from '@/components/navigation/navigation-icon';

export function ChatCenter({ inbox, children, personal = false }: { inbox: ReactNode; children?: ReactNode; personal?: boolean }) {
  return <div className={`page chat-center-page${personal ? ' chat-center-personal' : ''}`}>
    <PageHeader title={personal ? 'My chats' : 'Live chat'} className="chat-center-heading" actions={<Link className="button button-primary" href="/app/chat?start=1">Start a chat</Link>}/>
    <div className={`chat-center${children ? ' chat-center-selected' : ''}`}>
      <div className="chat-center-inbox">{inbox}</div>
      {children ?? <section className="chat-center-welcome" aria-labelledby="chat-welcome-title"><span className="chat-intake-icon"><NavigationIcon name="chat"/></span><h2 id="chat-welcome-title">Your next conversation starts here</h2><p>Choose a conversation from the inbox to read messages{personal ? ' and reply to IT.' : ', reply, and keep support moving.'}</p><span className="chat-welcome-hint">Messages and typing updates appear live.</span></section>}
    </div>
  </div>;
}
