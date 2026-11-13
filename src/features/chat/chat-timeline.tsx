import type { Dispatch, RefObject, SetStateAction } from 'react';

import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';

import { ChatTime } from './chat-time';
import { EditableChatMessage } from './editable-message';
import { ChatMediaAttachment } from './media-attachment';
import { mergeChatMessages, type ChatTimelineEntry, type RoomMessage } from './message-model';

type TimelineOptions = {
  timeline: ChatTimelineEntry[];
  viewerId: string;
  names: Record<string, string>;
  followLatest: RefObject<boolean>;
  threadRef: RefObject<HTMLDivElement | null>;
  conversationId: string;
  organizationId: string;
  open: boolean;
  outgoing: RoomMessage | null;
  confirmed: ReadonlyMap<string, RoomMessage>;
  setLiveMessages: Dispatch<SetStateAction<RoomMessage[]>>;
  uploading: boolean;
  uploadName: string;
};
/** Pure presentation: keep the room's existing DOM and mounted component identity. */
export function renderChatTimeline({
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
}: TimelineOptions) {
  return (
    <>
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
    </>
  );
}
