import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import type { SavedReply, SavedReplyContext } from '@/features/tickets/saved-replies';
import { SavedReplyPicker } from '@/features/tickets/saved-reply-picker';

import { chatAttachmentTypes } from './media';

type ComposerOptions = {
  open: boolean;
  kind: 'message' | 'internal_note';
  sendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isWorker: boolean;
  sending: boolean;
  stopTyping: () => void;
  setKind: Dispatch<SetStateAction<'message' | 'internal_note'>>;
  draftField: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  announceTyping: (value: string) => void;
  savedReplies?: SavedReply[];
  replyContext: SavedReplyContext;
  insertSavedReply: (text: string) => void;
  noteMode: boolean;
  uploading: boolean;
  upload: (file: File | undefined) => Promise<void>;
};
/** Pure presentation; draft/audience state stays in the existing room boundary. */
export function renderChatComposer({
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
}: ComposerOptions) {
  return (
    <>
      {open ? (
        <form
          className={`chat-composer${kind === 'internal_note' ? ' chat-composer-note' : ''}`}
          onSubmit={sendMessage}
        >
          <div className="chat-composer-heading">
            <label htmlFor="chat-draft">
              {kind === 'internal_note' && isWorker
                ? 'Internal note · IT only'
                : isWorker
                  ? 'Your message'
                  : 'Message'}
            </label>
            {isWorker && (
              <>
                <label className="sr-only" htmlFor="chat-kind">
                  Send as
                </label>
                <NativeSelect
                  id="chat-kind"
                  value={kind}
                  disabled={sending}
                  onChange={(event) => {
                    stopTyping();
                    setKind(event.target.value as 'message' | 'internal_note');
                  }}
                >
                  <option value="message">Reply to employee</option>
                  <option value="internal_note">Internal note · IT only</option>
                </NativeSelect>
              </>
            )}
          </div>
          <Textarea
            ref={draftField}
            id="chat-draft"
            className="min-h-16"
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
              className={buttonVariants({ variant: 'secondary', className: 'chat-file-button' })}
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
            <Button variant="primary" disabled={sending || !draft.trim()}>
              {sending
                ? 'Sending…'
                : kind === 'internal_note' && isWorker
                  ? 'Add internal note'
                  : 'Send'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="chat-closed-note">
          This conversation is closed. Its history remains available here.
        </p>
      )}
    </>
  );
}
