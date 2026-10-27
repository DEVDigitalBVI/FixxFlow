import { addTicketTag, removeTicketTag } from '@/app/app/tickets/organize-actions';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import { TAG_HINT, TICKET_TAG_LENGTH, TICKET_TAG_LIMIT } from './tags';

/** Staff-only tag editor for one ticket. */
export function TicketTags({
  ticketId,
  tags,
  suggestions,
  error = false,
}: {
  ticketId: string;
  tags: string[];
  suggestions: string[];
  error?: boolean;
}) {
  const available = suggestions.filter((tag) => !tags.includes(tag));
  return (
    <section className="settings-card stack" aria-labelledby="ticket-tags-heading">
      <h3 id="ticket-tags-heading">Tags</h3>
      {error ? (
        <p role="alert">Tags could not load. Refresh to try again.</p>
      ) : tags.length ? (
        <ul className="ticket-tag-list" aria-label="Tags on this ticket">
          {tags.map((tag) => (
            <li key={tag} className="ticket-tag">
              <span>{tag}</span>
              <ActionForm action={removeTicketTag}>
                <input type="hidden" name="ticketId" value={ticketId} />
                <input type="hidden" name="tag" value={tag} />
                <SubmitButton
                  className="ticket-tag-remove"
                  aria-label={`Remove tag ${tag}`}
                  title={`Remove tag ${tag}`}
                  pendingLabel="…"
                >
                  <span aria-hidden="true">
                    <NavigationIcon name="close" className="inline-icon" size={16} />
                  </span>
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No tags yet. Tags help group and filter related work.</p>
      )}
      {!error && tags.length < TICKET_TAG_LIMIT && (
        <ActionForm action={addTicketTag} className="ticket-tag-add" resetOnSuccess>
          <input type="hidden" name="ticketId" value={ticketId} />
          <div className="field">
            <label htmlFor={`ticket-tag-${ticketId}`}>Add a tag</label>
            <input
              id={`ticket-tag-${ticketId}`}
              className="input"
              name="tag"
              required
              maxLength={TICKET_TAG_LENGTH}
              list={`ticket-tag-options-${ticketId}`}
              autoComplete="off"
              aria-describedby={`ticket-tag-hint-${ticketId}`}
            />
            <datalist id={`ticket-tag-options-${ticketId}`}>
              {available.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            <small id={`ticket-tag-hint-${ticketId}`} className="muted">
              {TAG_HINT}
            </small>
          </div>
          <SubmitButton className="button button-secondary" pendingLabel="Adding…">
            Add tag
          </SubmitButton>
        </ActionForm>
      )}
      {!error && tags.length >= TICKET_TAG_LIMIT && (
        <p className="muted">This ticket has the maximum of {TICKET_TAG_LIMIT} tags.</p>
      )}
    </section>
  );
}
