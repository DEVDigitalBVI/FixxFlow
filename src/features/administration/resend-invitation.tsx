import { randomUUID } from 'node:crypto';

import { resendMemberInvitation } from '@/app/app/people/actions';
import { ActionForm } from '@/components/ui/action-form';
import { SubmissionKey } from '@/components/ui/submission-key';
import { SubmitButton } from '@/components/ui/submit-button';

export function ResendInvitation({ id, name }: { id: string; name: string }) {
  return (
    <section className="stack">
      <h4>Account setup</h4>
      <p className="muted">
        Send a new invitation if the original expired. The new link lasts 72 hours and replaces
        earlier invitation links.
      </p>
      <details>
        <summary>
          Send new invitation<span className="sr-only"> to {name}</span>
        </summary>
        <ActionForm action={resendMemberInvitation} className="stack" protectDraft={false}>
          <input type="hidden" name="userId" value={id} />
          <SubmissionKey value={randomUUID()} />
          <p>Send a fresh account setup email to {name}?</p>
          <SubmitButton variant="secondary" pendingLabel="Sending invitation…">
            Send invitation
          </SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
