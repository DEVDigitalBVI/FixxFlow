import { unwatchTicket, watchTicket } from '@/app/app/tickets/organize-actions';
import { ActionForm } from '@/components/ui/action-form';
import { RetryButton } from '@/components/ui/retry-button';
import { SubmitButton } from '@/components/ui/submit-button';

type Watcher = { userId: string; name: string };

/** Staff-only: follow updates without taking ownership of a ticket. */
export function TicketWatchers({
  ticketId,
  viewerId,
  admin,
  watchers,
  error = false,
}: {
  ticketId: string;
  viewerId: string;
  admin: boolean;
  watchers: Watcher[];
  error?: boolean;
}) {
  const watching = watchers.some((watcher) => watcher.userId === viewerId);
  return (
    <section className="ticket-following" aria-labelledby="ticket-watchers-heading">
      <div className="ticket-following-controls">
        <div className="ticket-following-copy">
          <h3 id="ticket-watchers-heading">Ticket notifications</h3>
          <p id="ticket-following-description" className="muted">
            Get notified when someone replies publicly or this ticket is resolved or reopened.
            Following won’t assign the ticket to you.
          </p>
          {!error && (
            <p id="ticket-following-state" className="muted">
              {watching
                ? 'You’re following updates on this ticket.'
                : 'You’re not following this ticket.'}
            </p>
          )}
        </div>
        {!error && (
          <ActionForm action={watching ? unwatchTicket : watchTicket}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <SubmitButton
              variant="secondary"
              aria-pressed={watching}
              aria-describedby="ticket-following-description ticket-following-state"
              pendingLabel={watching ? 'Stopping…' : 'Following…'}
            >
              {watching ? 'Stop following' : 'Follow updates'}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      {error ? (
        <div className="ticket-following-error">
          <p role="alert">
            We couldn’t load who follows this ticket. Try again to check your notifications.
          </p>
          <RetryButton label="Try again" />
        </div>
      ) : watchers.length > 0 ? (
        <details className="ticket-following-people">
          <summary>People following ({watchers.length})</summary>
          <ul className="ticket-link-list" aria-label="People following this ticket">
            {watchers.map((watcher) => (
              <li key={watcher.userId}>
                <span>
                  {watcher.name}
                  {watcher.userId === viewerId ? ' (you)' : ''}
                </span>
                {admin && watcher.userId !== viewerId && (
                  <ActionForm action={unwatchTicket}>
                    <input type="hidden" name="ticketId" value={ticketId} />
                    <input type="hidden" name="userId" value={watcher.userId} />
                    <SubmitButton variant="quiet" pendingLabel="Removing…">
                      Remove<span className="sr-only"> {watcher.name} from ticket updates</span>
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
