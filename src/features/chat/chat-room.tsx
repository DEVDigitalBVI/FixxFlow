'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useUnsavedChanges } from '@/components/ui/unsaved-changes';
import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import {
  insertIntoDraft,
  type SavedReply,
  type SavedReplyContext,
} from '@/features/tickets/saved-replies';
import { SavedReplyPicker } from '@/features/tickets/saved-reply-picker';
import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';
import { createClient } from '@/lib/supabase/client';
import { uploadAndRegister } from '@/lib/uploads';

import { ChatTime } from './chat-time';
import { EditableChatMessage } from './editable-message';
import { chatAttachmentTypes, validChatAttachment } from './media';
import { ChatMediaAttachment } from './media-attachment';
import { mergeChatMessages, parseChatMessage, type RoomMessage } from './message-model';
import { ChatReadUpdates } from './read-updates';
import { ChatSupportHours } from './support-hours';

export type { RoomMessage } from './message-model';

export type RoomAttachment = {
  id: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  storage_path: string;
  content_type?: string;
  uploaded_by?: string;
  url?: string;
};

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
  const router = useRouter();
  const [supabase] = useState(createClient);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);
  const remoteTimer = useRef<number | null>(null);
  const lastTyping = useRef(0);
  const [liveMessages, setLiveMessages] = useState<RoomMessage[]>([]);
  const [outgoing, setOutgoing] = useState<RoomMessage | null>(null);
  const confirmed = new Map(
    mergeChatMessages(liveMessages, initialMessages).map((message) => [message.id, message]),
  );
  const messages = [...confirmed.values()]
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .slice(-HISTORY_PAGE_SIZE);
  if (outgoing && !confirmed.has(outgoing.id)) messages.push(outgoing);
  const [liveAttachments, setLiveAttachments] = useState<RoomAttachment[]>([]);
  const files = new Map(liveAttachments.map((file) => [file.id, file]));
  for (const file of initialAttachments) files.set(file.id, file);
  const attachments = [...files.values()]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    .slice(-HISTORY_PAGE_SIZE);
  type Entry = { key: string; created_at: string } & (
    { type: 'message'; message: RoomMessage } | { type: 'file'; file: RoomAttachment }
  );
  const timeline: Entry[] = [
    ...messages.map((message) => ({
      type: 'message' as const,
      key: `message:${message.id}`,
      created_at: message.created_at,
      message,
    })),
    ...attachments.map((file) => ({
      type: 'file' as const,
      key: `file:${file.id}`,
      created_at: file.created_at,
      file,
    })),
  ].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.key.localeCompare(b.key),
  );
  const latestMessageId = timeline.at(-1)?.key;
  const followLatest = useRef(true);
  const [readingHistory, setReadingHistory] = useState(false);
  const [drafts, setDrafts] = useState({ message: '', internal_note: '' });
  const [kind, setKind] = useState<'message' | 'internal_note'>(
    isWorker ? 'internal_note' : 'message',
  );
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
  const pendingMessage = useRef<{ id: string; body: string; kind: typeof kind } | null>(null);
  const sendInFlight = useRef(false);
  const uploadInFlight = useRef(false);

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

  useEffect(() => {
    let disposed = false;
    const channel = supabase
      .channel(`chat:${conversationId}`, {
        config: { private: true, presence: { key: `${viewerId}:${crypto.randomUUID()}` } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        ({ new: row }) => {
          const message = parseChatMessage(row, organizationId, conversationId, isWorker);
          if (disposed || !message) return;
          setLiveMessages((current) =>
            mergeChatMessages(current, [message]).slice(-HISTORY_PAGE_SIZE),
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_conversations',
          filter: `id=eq.${conversationId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_attachments',
          filter: `conversation_id=eq.${conversationId}`,
        },
        refresh,
      )
      .on('presence', { event: 'sync' }, () => {
        const others = Object.values(channel.presenceState())
          .flat()
          .some((value) => {
            const id = (value as { userId?: string }).userId;
            return Boolean(id && id !== viewerId && (!participantId || id === participantId));
          });
        setOnline(others);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.userId === viewerId || (participantId && payload?.userId !== participantId))
          return;
        setTyping(Boolean(payload?.typing));
        if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
        if (payload?.typing) remoteTimer.current = window.setTimeout(() => setTyping(false), 3500);
      });
    channelRef.current = channel;
    void supabase.realtime
      .setAuth()
      .then(() => {
        if (disposed) return;
        channel.subscribe((status) => {
          if (disposed) return;
          setConnected(status === 'SUBSCRIBED');
          if (status !== 'SUBSCRIBED') {
            setOnline(false);
            setTyping(false);
          }
          if (status === 'SUBSCRIBED') {
            void channel.track({ userId: viewerId });
            refresh();
          }
        });
      })
      .catch(() => {
        if (!disposed) setConnected(false);
      });
    return () => {
      disposed = true;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, organizationId, viewerId, isWorker, participantId, supabase, refresh]);

  function stopTyping() {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: viewerId, typing: false },
    });
  }

  function announceTyping(value: string) {
    setDrafts((current) => ({ ...current, [kind]: value }));
    if (kind === 'internal_note' || !value.trim() || !connected) {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (now - lastTyping.current > 1000) {
      lastTyping.current = now;
      void channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: viewerId, typing: true },
      });
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: viewerId, typing: false },
      });
    }, 1800);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendInFlight.current || !open) return;
    sendInFlight.current = true;
    const audience = isWorker ? kind : 'message';
    if (
      !pendingMessage.current ||
      pendingMessage.current.body !== body ||
      pendingMessage.current.kind !== audience
    ) {
      pendingMessage.current = { id: crypto.randomUUID(), body, kind: audience };
    }
    const pending = pendingMessage.current;
    followLatest.current = true;
    setReadingHistory(false);
    setOutgoing({ ...pending, author_id: viewerId, created_at: new Date().toISOString() });
    stopTyping();
    setSending(true);
    setFeedback('');
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          id: pending.id,
          organization_id: organizationId,
          conversation_id: conversationId,
          author_id: viewerId,
          kind: audience,
          body,
        })
        .select('id, author_id, kind, body, created_at')
        .single();
      let saved = data;
      if (error) {
        const { data: existing } = await supabase
          .from('chat_messages')
          .select('id, author_id, kind, body, created_at')
          .eq('id', pending.id)
          .eq('organization_id', organizationId)
          .eq('conversation_id', conversationId)
          .maybeSingle();
        if (
          !existing ||
          existing.author_id !== viewerId ||
          existing.kind !== audience ||
          existing.body !== body
        )
          throw error;
        saved = existing;
      }
      if (saved)
        setLiveMessages((current) =>
          [...current.filter((item) => item.id !== saved.id), saved].slice(-HISTORY_PAGE_SIZE),
        );
      setDrafts((current) => ({
        ...current,
        [audience]: current[audience] === draft ? '' : current[audience],
      }));
      pendingMessage.current = null;
      refresh();
    } catch {
      setFeedback('Message not sent. Your draft is still here; try again.');
    } finally {
      setOutgoing(null);
      sendInFlight.current = false;
      setSending(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || !open || noteMode || uploadInFlight.current) return;
    if (!validChatAttachment(file)) {
      setFeedback(
        'Choose a nonempty photo, MP4, WebM, MOV, audio, PDF, text, Word, or Excel file up to 10 MB.',
      );
      return;
    }
    uploadInFlight.current = true;
    followLatest.current = true;
    setReadingHistory(false);
    setUploading(true);
    setUploadName(file.name);
    setFailedUpload(null);
    setFeedback(`Uploading ${file.name}…`);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `${organizationId}/${conversationId}/${viewerId}/${crypto.randomUUID()}-${safeName}`;
      const bucket = supabase.storage.from('chat-attachments');
      let savedFile: RoomAttachment | undefined;
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: async () => {
          const result = await supabase
            .from('chat_attachments')
            .insert({
              organization_id: organizationId,
              conversation_id: conversationId,
              uploaded_by: viewerId,
              storage_path: path,
              file_name: file.name,
              content_type: file.type,
              size_bytes: file.size,
            })
            .select(
              'id, file_name, size_bytes, created_at, storage_path, content_type, uploaded_by',
            )
            .single();
          if (result.data) savedFile = result.data;
          return result;
        },
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') {
        if (savedFile) {
          let url: string | undefined;
          try {
            const { data: signed } = await bucket.createSignedUrl(path, 3600);
            url = signed?.signedUrl;
          } catch {
            /* The file is saved; leave renewal to the shared media retry control. */
          }
          const attachment = { ...savedFile, url };
          setLiveAttachments((current) =>
            [...current.filter((item) => item.id !== attachment.id), attachment].slice(
              -HISTORY_PAGE_SIZE,
            ),
          );
        }
        setFeedback('Attachment added.');
        router.refresh();
      } else if (result === 'unconfirmed')
        setFeedback('We could not confirm the attachment. Refresh the file list before retrying.');
      else {
        setFailedUpload(file);
        setFeedback('The attachment could not be saved. Retry the upload or choose another file.');
      }
    } catch {
      setFeedback('The upload could not be confirmed. Refresh the file list before trying again.');
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }

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
        {timeline.map((entry) => {
          if (entry.type === 'file')
            return (
              <article
                key={entry.key}
                className={`chat-message chat-message-media${entry.file.uploaded_by === viewerId ? ' chat-message-own' : ''}`}
              >
                <div className="chat-message-meta">
                  <strong>
                    {entry.file.uploaded_by === viewerId
                      ? 'You'
                      : (names[entry.file.uploaded_by ?? ''] ?? 'Participant')}{' '}
                    · Attachment
                  </strong>
                  <ChatTime value={entry.created_at} />
                </div>
                <ChatMediaAttachment
                  file={entry.file}
                  onReady={() => {
                    if (followLatest.current)
                      threadRef.current?.scrollTo({
                        top: threadRef.current.scrollHeight,
                        behavior: 'instant',
                      });
                  }}
                />
              </article>
            );
          const message = entry.message;
          return (
            <article
              key={entry.key}
              className={`chat-message${message.author_id === viewerId ? ' chat-message-own' : ''}${message.kind === 'internal_note' ? ' chat-message-note' : ''}`}
            >
              <div className="chat-message-meta">
                <strong>
                  {message.author_id === viewerId
                    ? 'You'
                    : (names[message.author_id] ?? 'IT support')}
                  {message.kind === 'internal_note' ? ' · Internal note' : ''}
                </strong>
                <ChatTime value={message.created_at} />
              </div>
              <EditableChatMessage
                message={message}
                conversationId={conversationId}
                organizationId={organizationId}
                canEdit={open && message.author_id === viewerId && outgoing?.id !== message.id}
                onSaved={(updated) =>
                  setLiveMessages((current) =>
                    mergeChatMessages(current, [updated]).slice(-HISTORY_PAGE_SIZE),
                  )
                }
              />
              {outgoing?.id === message.id && !confirmed.has(message.id) && <small>Sending…</small>}
            </article>
          );
        })}
        {uploading && (
          <article className="chat-message chat-message-own" aria-label="Uploading attachment">
            <p>Uploading {uploadName}…</p>
          </article>
        )}
        {!timeline.length && !uploading && <p className="muted">No messages yet.</p>}
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
      {open ? (
        <form
          className={`chat-composer${kind === 'internal_note' ? ' chat-composer-note' : ''}`}
          onSubmit={sendMessage}
        >
          <div className="chat-composer-heading">
            <label htmlFor="chat-draft">
              {kind === 'internal_note' && isWorker ? 'Internal note · IT only' : 'Message'}
            </label>
            {isWorker && (
              <>
                <label className="sr-only" htmlFor="chat-kind">
                  Send as
                </label>
                <select
                  id="chat-kind"
                  className="input"
                  value={kind}
                  disabled={sending}
                  onChange={(event) => {
                    stopTyping();
                    setKind(event.target.value as 'message' | 'internal_note');
                  }}
                >
                  <option value="message">Reply to employee</option>
                  <option value="internal_note">Internal note · IT only</option>
                </select>
              </>
            )}
          </div>
          <textarea
            ref={draftField}
            id="chat-draft"
            className="input textarea"
            value={draft}
            aria-describedby="chat-audience"
            onChange={(event) => announceTyping(event.target.value)}
            onBlur={stopTyping}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={20000}
            placeholder="Write a message"
            required
          />
          <p id="chat-audience" className="muted">
            {kind === 'internal_note'
              ? 'Only IT staff can see this note. Files are always shared with the employee, so attaching is off for notes.'
              : isWorker
                ? 'Visible to the employee.'
                : 'Shared with IT support.'}{' '}
            Enter to send · Shift+Enter for a new line.
          </p>
          <div className="chat-composer-actions">
            {isWorker && savedReplies && (
              <SavedReplyPicker
                replies={savedReplies}
                context={replyContext}
                onInsert={insertSavedReply}
                disabled={sending}
              />
            )}
            <label
              className="button button-secondary chat-file-button"
              data-disabled={noteMode || undefined}
            >
              <input
                type="file"
                aria-label={
                  isWorker
                    ? 'Attach a file for the employee'
                    : 'Attach a photo, video, audio or file'
                }
                accept={chatAttachmentTypes.join(',')}
                aria-describedby={noteMode ? 'chat-audience' : 'chat-upload-hint'}
                disabled={uploading || noteMode}
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {uploading ? 'Uploading…' : isWorker ? 'Attach for employee' : 'Attach'}
            </label>
            <details className="chat-upload-guide">
              <summary>Files · 10 MB</summary>
              <p id="chat-upload-hint" className="muted">
                Up to 10 MB per file. Photos (JPEG, PNG, WebP), video (MP4, WebM, MOV), audio (MP3,
                M4A, WAV, WebM, Ogg), PDF, text, Word, or Excel. Include a text description of
                visual or spoken content in your message.
              </p>
            </details>
            <button className="button button-primary" disabled={sending || !draft.trim()}>
              {sending
                ? 'Sending…'
                : kind === 'internal_note' && isWorker
                  ? 'Add internal note'
                  : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <p className="chat-closed-note">
          This conversation is closed. Its history remains available here.
        </p>
      )}
      {feedback && (
        <p className="chat-feedback" role="status">
          {feedback}
        </p>
      )}
      {failedUpload && !uploading && open && !noteMode && (
        <button
          className="button button-secondary chat-upload-retry"
          type="button"
          onClick={() => void upload(failedUpload)}
        >
          Retry upload: {failedUpload.name}
        </button>
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
