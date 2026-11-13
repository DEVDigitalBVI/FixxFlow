'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Radio } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/input';
import { useUnsavedChanges } from '@/components/ui/unsaved-changes';
import type { TicketMessageKind, TicketStatus } from '@/types/database';

import { messageKinds } from './message-presentation';
import { insertIntoDraft, type SavedReply, type SavedReplyContext } from './saved-replies';
import { SavedReplyPicker } from './saved-reply-picker';
import { useTicketMutationState } from './ticket-mutation-state';

export type MessageResult = {
  error?: string;
  success?: string;
  messageSent?: boolean;
  statusChanged?: boolean;
  conflict?: boolean;
  revision?: number;
};

export function MessageComposer({
  ticketId,
  action,
  statusAction,
  revision,
  ticketStatus,
  staff = true,
  savedReplies,
  lazySavedReplies = false,
  replyContext = {},
}: {
  ticketId: string;
  staff?: boolean;
  action: (formData: FormData) => Promise<MessageResult>;
  statusAction?: (formData: FormData) => Promise<MessageResult>;
  revision?: number;
  ticketStatus?: TicketStatus;
  /** Staff only: reusable replies offered in the composer. */
  savedReplies?: SavedReply[];
  lazySavedReplies?: boolean;
  replyContext?: SavedReplyContext;
}) {
  const router = useRouter();
  const mutation = useTicketMutationState();
  const done = ticketStatus === 'resolved' || ticketStatus === 'closed';
  const [kind, setKind] = useState<TicketMessageKind>('reply');
  const [drafts, setDrafts] = useState({ reply: '', internal_note: '' });
  const [pending, setPending] = useState(false);
  const [uncertainStatuses, setUncertainStatuses] = useState<
    Partial<Record<TicketMessageKind, string>>
  >({});
  const retryStatus = uncertainStatuses[kind];
  const [result, setResult] = useState<MessageResult>({});
  const inFlight = useRef(false);
  const requestIds = useRef<Record<TicketMessageKind, string | null>>({
    reply: null,
    internal_note: null,
  });
  const draftVersions = useRef<Partial<Record<TicketMessageKind, number>>>({});
  const submissions = useRef<
    Partial<Record<TicketMessageKind, { revision?: number; status: string }>>
  >({});
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
    draftVersions.current[kind] ??= revision;
    setDrafts((existing) => ({ ...existing, [kind]: value }));
    requestIds.current[kind] = null;
    delete submissions.current[kind];
    setUncertainStatuses((current) => ({ ...current, [kind]: '' }));
    // Return to the draft with the caret after the inserted text.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange?.(caret, caret);
    });
  }

  async function send(formData: FormData) {
    if (inFlight.current) return;
    requestIds.current[kind] ??= crypto.randomUUID();
    formData.set('messageId', requestIds.current[kind]);
    submissions.current[kind] ??= {
      revision: draftVersions.current[kind] ?? revision,
      status: String(formData.get('status') ?? ''),
    };
    const submission = submissions.current[kind];
    formData.set('revision', String(submission.revision ?? ''));
    formData.set('status', submission.status);
    const combined = Boolean(submission.status && staff && statusAction);
    if (combined && mutation && !mutation.beginReplyStatus()) {
      delete submissions.current[kind];
      setResult({
        error: 'Save or discard the status edits before sending a reply with a status change.',
      });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setResult({});
    try {
      const response = await (submission.status && staff && statusAction ? statusAction : action)(
        formData,
      );
      setResult(response);
      if (response.error && !response.messageSent) {
        delete submissions.current[kind];
        setUncertainStatuses((current) => ({ ...current, [kind]: '' }));
      }
      if (response.conflict) router.refresh();
      if (response.messageSent || !response.error) {
        setDrafts((current) => ({ ...current, [kind]: '' }));
        requestIds.current[kind] = null;
        delete submissions.current[kind];
        delete draftVersions.current[kind];
        setUncertainStatuses((current) => ({ ...current, [kind]: '' }));
        router.refresh();
      }
    } catch {
      if (combined) setUncertainStatuses((current) => ({ ...current, [kind]: submission.status }));
      setResult({
        error: 'Your message could not be confirmed. Your draft is kept here; try sending again.',
      });
    } finally {
      if (combined) mutation?.endReplyStatus();
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
        const data = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent | undefined)
          ?.submitter as HTMLButtonElement | null;
        if (submitter?.name === 'status') data.set('status', submitter.value);
        void send(data);
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
              <Radio
                name="composerMode"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value as TicketMessageKind);
                  setResult({});
                }}
              />
              {value === 'reply' ? 'Reply to requester' : 'Internal note'}
            </label>
          ))}
        </fieldset>
      )}
      <div className="composer-audience" id="message-audience" role="status">
        {kind === 'internal_note' && <strong>Internal note · IT staff only</strong>}
        <span>{staff ? mode.audience : 'Visible to you and IT support.'}</span>
      </div>
      <label htmlFor="message-body">{staff ? mode.label : 'Your message'}</label>
      <Textarea
        ref={textarea}
        id="message-body"
        fieldSize="tall"
        name="body"
        required
        rows={4}
        maxLength={20000}
        readOnly={pending}
        value={drafts[kind]}
        onChange={(event) => {
          draftVersions.current[kind] ??= revision;
          setDrafts((current) => ({ ...current, [kind]: event.target.value }));
          requestIds.current[kind] = null;
          delete submissions.current[kind];
          setUncertainStatuses((current) => ({ ...current, [kind]: '' }));
        }}
        aria-describedby={`message-audience message-hint${result.error ? ' message-error' : ''}`}
        placeholder={
          kind === 'internal_note'
            ? 'Share troubleshooting details with IT staff…'
            : 'Write a message…'
        }
      />
      <div className="composer-footer">
        {staff && (savedReplies || lazySavedReplies) && (
          <SavedReplyPicker
            replies={savedReplies}
            lazy={lazySavedReplies}
            context={replyContext}
            onInsert={insertSavedReply}
            disabled={pending}
          />
        )}
        <small id="message-hint">
          Enter adds a new line. {staff && 'Drafts stay separate for each message type.'}
        </small>
        <div className="composer-send-actions">
          {retryStatus ? (
            <Button
              variant="primary"
              type="submit"
              name="status"
              value={retryStatus}
              disabled={pending || mutation?.replyStatusBlocked}
            >
              {pending
                ? 'Confirming…'
                : retryStatus === 'resolved'
                  ? 'Retry send & resolve'
                  : 'Retry send & wait for reply'}
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={pending}>
              {pending ? 'Sending…' : staff ? mode.action : 'Send message'}
            </Button>
          )}
          {staff && kind === 'reply' && statusAction && !done && !retryStatus && (
            <>
              {ticketStatus !== 'waiting_on_user' && (
                <Button
                  variant="secondary"
                  type="submit"
                  name="status"
                  value="waiting_on_user"
                  disabled={pending || mutation?.replyStatusBlocked}
                  aria-describedby={
                    mutation?.replyStatusBlocked && !pending ? 'reply-status-blocked' : undefined
                  }
                >
                  Send &amp; wait for reply
                </Button>
              )}
              <Button
                variant="secondary"
                type="submit"
                name="status"
                value="resolved"
                disabled={pending || mutation?.replyStatusBlocked}
                aria-describedby={
                  mutation?.replyStatusBlocked && !pending ? 'reply-status-blocked' : undefined
                }
              >
                Send &amp; resolve
              </Button>
            </>
          )}
        </div>
      </div>
      {staff &&
        kind === 'reply' &&
        statusAction &&
        !done &&
        mutation?.replyStatusBlocked &&
        !pending && (
          <p id="reply-status-blocked" className="muted" role="status">
            Save or discard the status edits, or wait for the current status action to finish,
            before sending and changing status.
          </p>
        )}
      {result.error && (
        <Alert id="message-error" as="p" tone="error" role="alert">
          {result.error}
          {(result.messageSent || result.conflict) && (
            <>
              {' '}
              <a href="#ticket-status">Review status</a>
            </>
          )}
        </Alert>
      )}
      {result.conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            draftVersions.current[kind] = revision;
            delete submissions.current[kind];
            setResult({ success: 'Latest ticket version selected. Review your reply, then send.' });
            textarea.current?.focus();
          }}
        >
          Use reviewed ticket version
        </Button>
      )}
      <p className="composer-result" role="status">
        {result.success}
      </p>
    </form>
  );
}
