'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useUnsavedChanges } from '@/components/ui/unsaved-changes';
import type { TicketMessageKind } from '@/types/database';

import { messageKinds } from './message-presentation';
import { insertIntoDraft, type SavedReply, type SavedReplyContext } from './saved-replies';
import { SavedReplyPicker } from './saved-reply-picker';

export type MessageResult = { error?: string; success?: string };

export function MessageComposer({
  ticketId,
  action,
  staff = true,
  savedReplies,
  replyContext = {},
}: {
  ticketId: string;
  staff?: boolean;
  action: (formData: FormData) => Promise<MessageResult>;
  /** Staff only: reusable replies offered in the composer. */
  savedReplies?: SavedReply[];
  replyContext?: SavedReplyContext;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<TicketMessageKind>('reply');
  const [drafts, setDrafts] = useState({ reply: '', internal_note: '' });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MessageResult>({});
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mode = messageKinds[kind];
  useUnsavedChanges(Boolean(drafts.reply.trim() || drafts.internal_note.trim()));

  function insertSavedReply(text: string) {
    const field = textarea.current;
    const current = drafts[kind];
    const { value, caret } = insertIntoDraft(
      current,
      text,
      field?.selectionStart ?? current.length,
      field?.selectionEnd ?? current.length,
    );
    setDrafts((existing) => ({ ...existing, [kind]: value }));
    requestId.current = null;
    // Return to the draft with the caret after the inserted text.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange?.(caret, caret);
    });
  }

  async function send(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult({});
    requestId.current ??= crypto.randomUUID();
    formData.set('messageId', requestId.current);
    try {
      const response = await action(formData);
      setResult(response);
      if (!response.error) {
        setDrafts((current) => ({ ...current, [kind]: '' }));
        requestId.current = null;
        router.refresh();
      }
    } catch {
      setResult({
        error: 'Your message could not be confirmed. Your draft is kept here; try sending again.',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
      textarea.current?.focus();
    }
  }

  // React form actions reset native radio controls after success. Keep submission
  // under our control so the selected audience and its separate draft stay aligned.
  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        void send(new FormData(event.currentTarget));
      }}
      className={`message-composer composer-${kind}`}
      aria-busy={pending}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="kind" value={kind} />
      {staff && (
        <fieldset className="composer-modes" disabled={pending}>
          <legend>Who is this message for?</legend>
          {Object.keys(messageKinds).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="composerMode"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value as TicketMessageKind);
                  setResult({});
                  requestId.current = null;
                }}
              />
              {value === 'reply' ? 'Reply to requester' : 'Internal note'}
            </label>
          ))}
        </fieldset>
      )}
      <div className="composer-audience" id="message-audience" role="status">
        <strong>{staff ? mode.label : 'Reply to IT'}</strong>
        <span>{staff ? mode.audience : 'Visible to you and IT support.'}</span>
      </div>
      <label htmlFor="message-body">{staff ? mode.label : 'Your message'}</label>
      <textarea
        ref={textarea}
        id="message-body"
        className="input textarea"
        name="body"
        required
        rows={4}
        maxLength={20000}
        readOnly={pending}
        value={drafts[kind]}
        onChange={(event) => {
          setDrafts((current) => ({ ...current, [kind]: event.target.value }));
          requestId.current = null;
        }}
        aria-describedby={`message-audience message-hint${result.error ? ' message-error' : ''}`}
        placeholder={
          kind === 'internal_note'
            ? 'Share troubleshooting details with IT staff…'
            : 'Write a message…'
        }
      />
      <div className="composer-footer">
        {staff && savedReplies && (
          <SavedReplyPicker
            replies={savedReplies}
            context={replyContext}
            onInsert={insertSavedReply}
            disabled={pending}
          />
        )}
        <small id="message-hint">
          Enter adds a new line. {staff && 'Drafts stay separate for each message type.'}
        </small>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? 'Sending…' : mode.action}
        </button>
      </div>
      {result.error && (
        <p id="message-error" className="alert alert-error" role="alert">
          {result.error}
        </p>
      )}
      <p className="composer-result" role="status">
        {result.success}
      </p>
    </form>
  );
}
