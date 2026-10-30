'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { workTicket } from '@/app/app/tickets/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import type { TicketStatus } from '@/types/database';

import { ticketStatuses } from './presentation';

type WorkTicket = {
  id: string;
  revision: number;
  status: TicketStatus;
  assigned_technician_id: string | null;
};
export function TicketWorkActions({
  ticket,
  assignee,
  stage = 'all',
}: {
  ticket: WorkTicket;
  assignee: string;
  stage?: 'all' | 'assignment' | 'resolution';
}) {
  const router = useRouter();
  const heading = useId();
  const statusHint = useId();
  const [dirty, setDirty] = useState(false);
  const [statusDraft, setStatusDraft] = useState(ticket.status);
  const [baseline, setBaseline] = useState(ticket.revision);
  const [conflict, setConflict] = useState(false);
  const expectedRevision = dirty || conflict ? baseline : ticket.revision;
  const stale = conflict || expectedRevision !== ticket.revision;
  const done = ticket.status === 'resolved' || ticket.status === 'closed';
  const action = async (data: FormData) => {
    const result = await workTicket(data);
    if (result.conflict) setConflict(true);
    if (result.success && result.revision) {
      setBaseline(result.revision);
      setDirty(false);
      setConflict(false);
    }
    if (result.success || result.conflict) router.refresh();
    return result;
  };
  const fields = (intent: string) => (
    <>
      <input type="hidden" name="ticketId" value={ticket.id} />
      <input type="hidden" name="revision" value={expectedRevision} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
  return (
    <section className="settings-card ticket-work" aria-labelledby={heading}>
      <div className="section-heading-row">
        <div>
          <h3 id={heading}>
            {stage === 'resolution' ? 'Ticket outcome' : 'Ownership & work status'}
          </h3>
          <p className="muted">
            Owner: <strong>{assignee}</strong>
          </p>
        </div>
        {stage === 'all' && (
          <a className={buttonVariants({ variant: 'quiet' })} href="#ticket-conversation">
            Reply or add a note
          </a>
        )}
      </div>
      <p className="muted">
        {done
          ? 'Review the conversation or reopen this ticket if more work is needed.'
          : !ticket.assigned_technician_id
            ? 'Assign the ticket, reply to the requester, then resolve it when the issue is fixed.'
            : 'Keep the requester updated. When the issue is fixed, set the status to Resolved.'}
      </p>
      {stale ? (
        <div role="status">
          <p>The ticket has changed. Review its current status and owner before continuing.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setBaseline(ticket.revision);
              setDirty(false);
              setConflict(false);
              router.refresh();
            }}
          >
            Use latest ticket
          </Button>
        </div>
      ) : (
        <div className="ticket-work-controls">
          {stage !== 'resolution' && !done && !ticket.assigned_technician_id && (
            <ActionForm action={action} protectDraft={false}>
              {fields('take')}
              <SubmitButton variant="primary" pendingLabel="Assigning…">
                Assign to me
              </SubmitButton>
            </ActionForm>
          )}
          {stage !== 'resolution' &&
            !done &&
            ticket.assigned_technician_id &&
            ticket.status !== 'in_progress' && (
              <ActionForm action={action} protectDraft={false}>
                {fields('start')}
                <SubmitButton variant="primary" pendingLabel="Starting…">
                  Start work
                </SubmitButton>
              </ActionForm>
            )}
          {stage !== 'assignment' && (
            <ActionForm action={action} protectDraft={false} className="ticket-status-action">
              {fields('status')}
              <label>
                Status
                <NativeSelect
                  name="status"
                  aria-describedby={statusHint}
                  value={dirty ? statusDraft : ticket.status}
                  onChange={(event) => {
                    setStatusDraft(event.target.value as TicketStatus);
                    setBaseline(ticket.revision);
                    setDirty(true);
                  }}
                >
                  {Object.entries(ticketStatuses).map(([value, item]) => (
                    <option key={value} value={value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <SubmitButton variant="primary" pendingLabel="Saving status…">
                Save status
              </SubmitButton>
              <p id={statusHint} className="muted ticket-status-hint">
                {dirty
                  ? `Unsaved status: ${ticketStatuses[statusDraft].label}. Select Save status to apply it.`
                  : 'Choose a status, then select Save status to apply it.'}
              </p>
              {statusDraft === 'waiting_on_user' && (
                <p className="muted">
                  Ask the requester what you need in a public reply. Waiting pauses only the
                  resolution SLA; their next reply resumes work automatically.
                </p>
              )}
            </ActionForm>
          )}
        </div>
      )}
    </section>
  );
}
