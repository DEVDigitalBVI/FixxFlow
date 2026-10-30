import Link from 'next/link';

import { deleteQueueView, saveQueueView } from '@/app/app/tickets/view-actions';
import { ActionForm } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

import { SAVED_VIEW_LIMIT, SAVED_VIEW_NAME_LENGTH } from './queue-views';

type SavedView = { id: string; name: string; query: string };

/** Staff-only personal shortcuts to queue filter combinations. */
export function SavedQueueViews({
  views,
  currentQuery,
  error = false,
}: {
  views: SavedView[];
  currentQuery: string;
  error?: boolean;
}) {
  const currentView = views.find((view) => view.query === currentQuery);
  return (
    <details className="saved-queue-views">
      <summary>
        Saved views{views.length ? ` · ${views.length}` : ''}
        {currentView ? ` · Showing “${currentView.name}”` : ''}
      </summary>
      <div className="stack">
        {error ? (
          <p role="alert">Saved views could not load. Refresh to try again.</p>
        ) : views.length ? (
          <ul className="ticket-link-list" aria-label="Your saved views">
            {views.map((view) => (
              <li key={view.id}>
                <Link
                  href={`/app/tickets${view.query ? `?${view.query}` : ''}`}
                  aria-current={view.id === currentView?.id ? 'page' : undefined}
                >
                  {view.name}
                </Link>
                <ActionForm action={deleteQueueView}>
                  <input type="hidden" name="id" value={view.id} />
                  <SubmitButton variant="quiet" pendingLabel="Deleting…">
                    Delete<span className="sr-only"> saved view {view.name}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Save filters you use often, such as unassigned urgent tickets, and return in one click.
            Saved views are visible only to you.
          </p>
        )}
        {!error && !currentView && views.length < SAVED_VIEW_LIMIT && (
          <ActionForm action={saveQueueView} className="ticket-tag-add" resetOnSuccess>
            <input type="hidden" name="query" value={currentQuery} />
            <div className="field">
              <label htmlFor="saved-view-name">Save the current filters as</label>
              <Input
                id="saved-view-name"
                name="name"
                required
                maxLength={SAVED_VIEW_NAME_LENGTH}
                autoComplete="off"
              />
            </div>
            <SubmitButton variant="secondary" pendingLabel="Saving…">
              Save filters
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </details>
  );
}
