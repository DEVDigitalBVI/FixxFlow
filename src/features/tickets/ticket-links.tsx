import Link from 'next/link';

import { linkTicket, markTicketDuplicate, unlinkTicket } from '@/app/app/tickets/organize-actions';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import type { TicketStatus } from '@/types/database';

import { ticketStatuses } from './presentation';

export type LinkedTicket = {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
  /** How the other ticket relates to this one. */
  relation: 'related' | 'main' | 'duplicate';
};

const relationLabels: Record<LinkedTicket['relation'], string> = {
  related: 'Related',
  main: 'Main ticket · this is a duplicate',
  duplicate: 'Duplicate of this ticket',
};

const DEFAULT_MESSAGE =
  'Thanks for reporting this. IT is already working on the same issue under another request, so we have closed this one to avoid duplicate work. Reply here if your situation is different.';

/** Staff-only related and duplicate ticket links for one ticket. */
export function TicketLinks({
  ticketId,
  revision,
  status,
  links,
  error = false,
}: {
  ticketId: string;
  revision: number;
  status: TicketStatus;
  links: LinkedTicket[];
  error?: boolean;
}) {
  const isDuplicate = links.some((link) => link.relation === 'main');
  return (
    <section className="settings-card stack" aria-labelledby="ticket-links-heading">
      <h3 id="ticket-links-heading">Related tickets</h3>
      {error ? (
        <p role="alert">Related tickets could not load. Refresh to try again.</p>
      ) : links.length ? (
        <ul className="ticket-link-list">
          {links.map((link) => (
            <li key={link.id}>
              <div>
                <Link href={`/app/tickets/${link.id}`}>
                  #{link.number} {link.title}
                </Link>
                <span className="muted">
                  {relationLabels[link.relation]} · {ticketStatuses[link.status].label}
                </span>
              </div>
              <ActionForm action={unlinkTicket}>
                <input type="hidden" name="ticketId" value={ticketId} />
                <input type="hidden" name="linkedId" value={link.id} />
                <SubmitButton className="button button-quiet" pendingLabel="Removing…">
                  Unlink<span className="sr-only"> ticket #{link.number}</span>
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No related tickets. Link tickets about the same issue or work.</p>
      )}
      {!error && (
        <ActionForm action={linkTicket} className="ticket-tag-add" resetOnSuccess>
          <input type="hidden" name="ticketId" value={ticketId} />
          <div className="field">
            <label htmlFor={`link-ticket-${ticketId}`}>Link a related ticket</label>
            <input
              id={`link-ticket-${ticketId}`}
              className="input"
              name="ticketNumber"
              required
              inputMode="numeric"
              placeholder="#1042"
              autoComplete="off"
            />
          </div>
          <SubmitButton className="button button-secondary" pendingLabel="Linking…">
            Link ticket
          </SubmitButton>
        </ActionForm>
      )}
      {!error && status !== 'closed' && !isDuplicate && (
        <details className="ticket-duplicate">
          <summary className="button button-quiet">Close as a duplicate…</summary>
          <ActionForm action={markTicketDuplicate} className="stack">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="revision" value={revision} />
            <p className="muted">
              Links this ticket to the main ticket and closes it. Conversations stay separate, so
              requesters never see each other’s messages. Internal notes are added to both tickets.
            </p>
            <div className="field">
              <label htmlFor={`duplicate-main-${ticketId}`}>Main ticket number</label>
              <input
                id={`duplicate-main-${ticketId}`}
                className="input"
                name="mainNumber"
                required
                inputMode="numeric"
                placeholder="#1042"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`duplicate-message-${ticketId}`}>
                Message to the requester (optional)
              </label>
              <textarea
                id={`duplicate-message-${ticketId}`}
                className="input textarea"
                name="message"
                rows={3}
                maxLength={20000}
                defaultValue={DEFAULT_MESSAGE}
                aria-describedby={`duplicate-message-hint-${ticketId}`}
              />
              <small id={`duplicate-message-hint-${ticketId}`} className="muted">
                Sent as a public reply on this ticket. Clear it to close without a message.
              </small>
            </div>
            <SubmitButton className="button button-primary" pendingLabel="Closing…">
              Close as duplicate
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
