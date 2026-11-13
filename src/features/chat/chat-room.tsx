'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/components/ui/unsaved-changes';
import {
  insertIntoDraft,
  type SavedReply,
  type SavedReplyContext,
} from '@/features/tickets/saved-replies';
import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';
import { createClient } from '@/lib/supabase/client';

import { renderChatComposer } from './chat-composer';
import { renderChatTimeline } from './chat-timeline';
import { buildChatTimeline, type RoomAttachment, type RoomMessage } from './message-model';
import { ChatReadUpdates } from './read-updates';
import { ChatSupportHours } from './support-hours';
import { useChatChannel } from './use-chat-channel';
import { useChatSend } from './use-chat-send';
import { useChatUpload } from './use-chat-upload';

export type { RoomMessage } from './message-model';

export type { RoomAttachment } from './message-model';

export function ChatRoom({
  conversationId,
  organizationId,
  viewerId,
  isWorker,
  open,
  names,
  initialMessages,
  attachments: initialAttachments,
  readThrough,
  supportName = 'IT support team',
  assigned = false,
  participantId,
  savedReplies,
  replyContext = {},
  timeZone,
  initialAt,
}: {
  conversationId: string;
  organizationId: string;
  viewerId: string;
  isWorker: boolean;
  open: boolean;
  names: Record<string, string>;
  initialMessages: RoomMessage[];
  attachments: RoomAttachment[];
  readThrough?: string;
  supportName?: string;
  assigned?: boolean;
  participantId?: string;
  /** Staff only: reusable replies offered in the composer. */
  savedReplies?: SavedReply[];
  replyContext?: SavedReplyContext;
  timeZone?: string;
  initialAt?: number;
}) {
  const [supabase] = useState(createClient);
  const [liveMessages, setLiveMessages] = useState<RoomMessage[]>([]);
  const [outgoing, setOutgoing] = useState<RoomMessage | null>(null);
  const [liveAttachments, setLiveAttachments] = useState<RoomAttachment[]>([]);
  const { confirmed, attachments, timeline } = buildChatTimeline({
    liveMessages,
    initialMessages,
    outgoing,
    liveAttachments,
    initialAttachments,
  });
  const latestMessageId = timeline.at(-1)?.key;
  const followLatest = useRef(true);
  const [readingHistory, setReadingHistory] = useState(false);
  const [drafts, setDrafts] = useState({ message: '', internal_note: '' });
  const [kind, setKind] = useState<'message' | 'internal_note'>('message');
  const draft = drafts[kind];
  // Chat files are always visible to the employee, so notes cannot carry them.
  const noteMode = isWorker && kind === 'internal_note';
  const draftField = useRef<HTMLTextAreaElement>(null);

  function insertSavedReply(text: string) {
    const field = draftField.current;
    const { value, caret } = insertIntoDraft(
      draft,
      text,
      field?.selectionStart ?? draft.length,
      field?.selectionEnd ?? draft.length,
    );
    setDrafts((current) => ({ ...current, [kind]: value }));
    // Return to the draft with the caret after the inserted text.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange?.(caret, caret);
    });
  }

  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [failedUpload, setFailedUpload] = useState<File | null>(null);
  useUnsavedChanges(Boolean(drafts.message.trim() || drafts.internal_note.trim() || uploading));
  const [feedback, setFeedback] = useState('');
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [seenMessageId, setSeenMessageId] = useState(latestMessageId);
  const newMessages = timeline.length > 0 && latestMessageId !== seenMessageId;
  const refresh = useRouteRefresh(connected ? 60000 : 15000);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && followLatest.current) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: 'instant' });
    }
  }, [latestMessageId, uploading]);

  const { stopTyping, announceTyping: broadcastTyping } = useChatChannel({
    supabase,
    conversationId,
    organizationId,
    viewerId,
    isWorker,
    participantId,
    connected,
    refresh,
    setLiveMessages,
    setConnected,
    setOnline,
    setTyping,
  });
  function announceTyping(value: string) {
    setDrafts((current) => ({ ...current, [kind]: value }));
    broadcastTyping(value, kind);
  }

  const sendMessage = useChatSend({
    supabase,
    draft,
    kind,
    open,
    isWorker,
    organizationId,
    conversationId,
    viewerId,
    followLatestRef: followLatest,
    setReadingHistory,
    setOutgoing,
    stopTyping,
    setSending,
    setFeedback,
    setLiveMessages,
    setDrafts,
    refresh,
  });

  const upload = useChatUpload({
    supabase,
    open,
    noteMode,
    organizationId,
    conversationId,
    viewerId,
    followLatestRef: followLatest,
    setReadingHistory,
    setUploading,
    setUploadName,
    setFailedUpload,
    setFeedback,
    setLiveAttachments,
  });

  return (
    <section className="chat-room" aria-label="Conversation">
      {!isWorker && open && !online && (
        <ChatSupportHours timeZone={timeZone} initialAt={initialAt} />
      )}
      <div className="chat-room-toolbar">
        <div className="chat-live-state" role="status">
          <span className={online ? 'chat-online' : ''}>
            {online
              ? `${isWorker ? 'Employee' : supportName} is online`
              : !connected
                ? `Connecting to ${isWorker ? 'the employee' : supportName}…`
                : isWorker
                  ? 'Employee · Not in chat'
                  : assigned
                    ? `${supportName} · Not in chat`
                    : 'Waiting for your IT support team'}
          </span>
          <span className="sr-only">
            {connected ? 'Live' : 'Reconnecting · updates may be delayed'}
          </span>
        </div>
        <Link
          className="chat-history-link"
          href={`/app/chat/${conversationId}/history`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Earlier messages <span className="sr-only">(opens in a new tab)</span>
        </Link>
        {attachments.length > 0 && (
          <Link
            className="chat-history-link"
            href={`/app/chat/${conversationId}/history?view=files`}
          >
            Files ({attachments.length})
          </Link>
        )}
      </div>
      <div
        className="chat-thread"
        ref={threadRef}
        onScroll={(event) => {
          const thread = event.currentTarget;
          followLatest.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
          setReadingHistory(!followLatest.current);
          if (followLatest.current) setSeenMessageId(latestMessageId);
        }}
        tabIndex={0}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {renderChatTimeline({
          timeline,
          viewerId,
          names,
          followLatest,
          threadRef,
          conversationId,
          organizationId,
          open,
          outgoing,
          confirmed,
          setLiveMessages,
          uploading,
          uploadName,
        })}
      </div>
      {newMessages && readingHistory && (
        <button
          className="chat-new-messages"
          type="button"
          onClick={() => {
            followLatest.current = true;
            setReadingHistory(false);
            threadRef.current?.scrollTo({
              top: threadRef.current.scrollHeight,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            });
            setSeenMessageId(latestMessageId);
          }}
        >
          New messages ↓
        </button>
      )}
      <div className="chat-typing" role="status">
        {typing ? `${isWorker ? 'Employee' : supportName} is typing…` : ''}
      </div>
      {renderChatComposer({
        open,
        kind,
        sendMessage,
        isWorker,
        sending,
        stopTyping,
        setKind,
        draftField,
        draft,
        announceTyping,
        savedReplies,
        replyContext,
        insertSavedReply,
        noteMode,
        uploading,
        upload,
      })}
      {feedback && (
        <p className="chat-feedback" role="status">
          {feedback}
        </p>
      )}
      {failedUpload && !uploading && open && !noteMode && (
        <Button
          variant="secondary"
          className="chat-upload-retry"
          type="button"
          onClick={() => void upload(failedUpload)}
        >
          Retry upload: {failedUpload.name}
        </Button>
      )}
      {readThrough && (
        <ChatReadUpdates
          conversationId={conversationId}
          organizationId={organizationId}
          viewerId={viewerId}
          through={readThrough}
          active={!readingHistory}
        />
      )}
    </section>
  );
}
