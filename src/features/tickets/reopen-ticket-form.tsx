'use client';

import { useId, useRef, useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import type { ActionResult } from '@/lib/action-result';

export function ReopenTicketForm({
  ticketId,
  revision,
  action,
}: {
  ticketId: string;
  revision: number;
  action: (data: FormData) => Promise<ActionResult>;
}) {
  const id = useId();
  const [baseline, setBaseline] = useState(revision);
  const token = useRef<string | null>(null);
  const [reason, setReason] = useState('');
  const submit = async (data: FormData) => {
    token.current ??= crypto.randomUUID();
    data.set('requestToken', token.current);
    return action(data);
  };
  return (
    <details className="portal-detail-card ticket-reopen-disclosure">
      <summary className={buttonVariants({ variant: 'primary' })}>Reopen ticket</summary>
      <ActionForm action={submit} className="stack">
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="revision" value={baseline} />
        {revision !== baseline && (
          <Alert tone="warning" role="status">
            <p>
              This ticket changed while you were writing. Review its latest details before
              reopening.
            </p>
            <a href={`/app/tickets/${ticketId}`} target="_blank" rel="noopener noreferrer">
              Review current ticket in a new tab
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBaseline(revision);
                token.current = null;
              }}
            >
              Use latest ticket
            </Button>
          </Alert>
        )}
        <div className="field">
          <label htmlFor={id}>Why are you reopening this ticket?</label>
          <Textarea
            id={id}
            name="reason"
            required
            rows={3}
            maxLength={2000}
            value={reason}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setReason(event.target.value);
              token.current = null;
            }}
          />
          <p id={`${id}-hint`} className="muted">
            Tell IT what is still wrong with the same issue. Your explanation is included in the
            ticket history and reopening email.
          </p>
        </div>
        <SubmitButton variant="primary" pendingLabel="Reopening…">
          Reopen ticket
        </SubmitButton>
      </ActionForm>
    </details>
  );
}
