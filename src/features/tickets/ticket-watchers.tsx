import { unwatchTicket, watchTicket } from '@/app/app/tickets/organize-actions';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

type Watcher = { userId: string; name: string };

/** Staff-only: follow a ticket without being assigned. */
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
    <section className="settings-card stack" aria-labelledby="ticket-watchers-heading">
      <div className="section-heading-row">
        <h3 id="ticket-watchers-heading">Watchers</h3>
        {!error && (
          <ActionForm action={watching ? unwatchTicket : watchTicket}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <SubmitButton
              variant={watching ? 'secondary' : 'primary'}
              aria-pressed={watching}
              pendingLabel={watching ? 'Stopping…' : 'Watching…'}
            >
              {watching ? 'Stop watching' : 'Watch ticket'}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      <p className="muted">
        Watchers are notified of public replies and when the ticket is resolved or reopened. Only IT
        staff can watch tickets.
      </p>
      {error ? (
        <p role="alert">Watchers could not load. Refresh to try again.</p>
      ) : watchers.length ? (
        <ul className="ticket-link-list">
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
                    Remove<span className="sr-only"> {watcher.name} as a watcher</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No one is watching this ticket.</p>
      )}
    </section>
  );
}
