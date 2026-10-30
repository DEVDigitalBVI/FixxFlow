import { deleteSavedReply, saveSavedReply } from '@/app/app/administration/saved-replies/actions';
import { ActionForm } from '@/components/ui/action-form';
import { buttonVariants } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

import {
  SAVED_REPLY_BODY_LIMIT,
  SAVED_REPLY_TITLE_LIMIT,
  savedReplyPlaceholders,
} from './saved-replies';

type Reply = { id: string; title: string; body: string; revision: number };

export function SavedReplyEditor({ reply }: { reply?: Reply }) {
  const key = reply?.id ?? 'new';
  return (
    <div className="stack">
      <ActionForm action={saveSavedReply} className="stack" resetOnSuccess={!reply}>
        {reply && (
          <>
            <input type="hidden" name="id" value={reply.id} />
            <input type="hidden" name="revision" value={reply.revision} />
          </>
        )}
        <div className="field">
          <label htmlFor={`saved-reply-title-${key}`}>Title</label>
          <Input
            id={`saved-reply-title-${key}`}
            name="title"
            required
            minLength={2}
            maxLength={SAVED_REPLY_TITLE_LIMIT}
            defaultValue={reply?.title}
            aria-describedby={`saved-reply-title-hint-${key}`}
          />
          <small id={`saved-reply-title-hint-${key}`} className="muted">
            A short name staff will search for, such as “Password reset steps”.
          </small>
        </div>
        <div className="field">
          <label htmlFor={`saved-reply-body-${key}`}>Reply text</label>
          <Textarea
            id={`saved-reply-body-${key}`}
            name="body"
            fieldSize="tall"
            required
            rows={6}
            maxLength={SAVED_REPLY_BODY_LIMIT}
            defaultValue={reply?.body}
            aria-describedby={`saved-reply-placeholders-${key}`}
          />
        </div>
        <details className="saved-reply-placeholders" id={`saved-reply-placeholders-${key}`}>
          <summary>Placeholders you can use</summary>
          <p className="muted">
            These are filled in when staff insert the reply. Anything that can’t be filled stays
            visible so it can be edited before sending.
          </p>
          <dl>
            {savedReplyPlaceholders.map((item) => (
              <div key={item.token}>
                <dt>
                  <code>{item.token}</code>
                </dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        </details>
        <SubmitButton variant="primary">
          {reply ? 'Save changes' : 'Create saved reply'}
        </SubmitButton>
      </ActionForm>
      {reply && (
        <details className="saved-reply-delete">
          <summary className={buttonVariants({ variant: 'quiet' })}>Delete saved reply</summary>
          <ActionForm action={deleteSavedReply} className="stack">
            <input type="hidden" name="id" value={reply.id} />
            <p>
              Delete “{reply.title}”? Staff will no longer be able to insert it. Messages already
              sent are not affected.
            </p>
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Delete “{reply.title}”
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
