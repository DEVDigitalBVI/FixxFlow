import { randomUUID } from 'node:crypto';

import { PageHeader } from '@/components/ui/page-header';
import { ChatCenter } from '@/features/chat/chat-center';
import { ChatInbox } from '@/features/chat/chat-inbox';
import { loadChatInbox } from '@/features/chat/inbox-data';
import { normalizeChatView } from '@/features/chat/inbox-model';
import { ChatIntakeGuide, StartChatForm } from '@/features/chat/start-chat-form';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; view?: string; start?: string }>;
}) {
  const viewer = await requireViewer();
  const { error: message, view, start } = await searchParams;
  if (start === '1' || message)
    return (
      <div
        className={
          viewer.role === 'end_user' ? 'portal-page chat-intake-page' : 'page chat-intake-page'
        }
      >
        <PageHeader
          title="Start a chat"
          eyebrow="Your IT support"
          description="Tell us what’s happening. We’ll take it from here."
          back={{ href: '/app/chat', label: 'Back to chats' }}
        />
        <div className="chat-intake-layout">
          <StartChatForm
            submissionKey={randomUUID()}
            initialError={message}
            timeZone={viewer.organizationTimezone}
            initialAt={new Date().getTime()}
          />
          <ChatIntakeGuide />
        </div>
      </div>
    );
  const supabase = await createClient();
  const activeView = normalizeChatView(view);
  const inbox = await loadChatInbox(supabase, viewer, activeView);
  const personal = viewer.role === 'end_user';
  return (
    <ChatCenter
      personal={personal}
      inbox={
        <ChatInbox
          {...inbox}
          view={activeView}
          organizationId={viewer.organizationId}
          viewerId={viewer.id}
          personal={personal}
        />
      }
    />
  );
}
