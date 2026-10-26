import { RetryButton } from '@/components/ui/retry-button';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { AnnouncementEditor, AnnouncementForm } from './service-announcement-forms';

export async function ServiceAnnouncementPanel({
  organizationId,
  ticketId,
  ownerId,
}: {
  organizationId: string;
  ticketId: string;
  ownerId: string;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || viewer.organizationId !== organizationId) return null;
  const db = await createClient();
  const [draftResult, liveResult, ticketResult] = await Promise.all([
    db
      .from('service_announcement_drafts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .maybeSingle(),
    db
      .from('service_announcements')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .is('withdrawn_at', null)
      .maybeSingle(),
    db
      .from('tickets')
      .select('status')
      .eq('organization_id', organizationId)
      .eq('id', ticketId)
      .maybeSingle(),
  ]);
  if (draftResult.error || liveResult.error || ticketResult.error)
    return (
      <section className="stack" aria-label="Workspace announcement">
        <h3>Workspace announcement</h3>
        <p role="alert">
          Announcements could not load. <RetryButton />
        </p>
      </section>
    );
  const draft = draftResult.data,
    live = liveResult.data,
    manager = viewer.role === 'administrator' || viewer.id === ownerId,
    terminal = ['resolved', 'closed'].includes(ticketResult.data?.status ?? 'closed');
  return (
    <section className="stack" aria-labelledby="workspace-announcement-heading">
      <h3 id="workspace-announcement-heading">Workspace announcement</h3>
      <p className="muted">
        Let employees know IT is already working on an issue. Published notices appear on their home
        page and before a new request. Resolving or closing this ticket removes the notice;
        reopening does not republish it. No email is sent.
      </p>
      {live ? (
        <div className="settings-card stack">
          <strong>Visible to everyone: {live.title}</strong>
          <p className="ticket-description">{live.body}</p>
          <p>
            Published <Timestamp value={live.published_at} />
          </p>
        </div>
      ) : (
        <p className="muted">No announcement is visible to employees.</p>
      )}
      {terminal ? (
        <p>Reopen this ticket to prepare a new announcement.</p>
      ) : (
        <>
          <details>
            <summary>{draft ? 'Edit announcement draft' : 'Prepare an announcement'}</summary>
            <AnnouncementEditor
              ticketId={ticketId}
              revision={draft?.revision ?? 0}
              title={draft?.title ?? ''}
              body={draft?.body ?? ''}
            />
          </details>
          {draft && (
            <details>
              <summary>Review saved announcement · revision {draft.revision}</summary>
              <div className="stack">
                <p>
                  <strong>Audience: Everyone in this workspace</strong>
                </p>
                <h4>{draft.title}</h4>
                <p className="ticket-description">{draft.body}</p>
                <p className="muted">
                  Saved <Timestamp value={draft.updated_at} />. Review this saved text; unsaved
                  edits are not published.
                </p>
                {live?.draft_revision === draft.revision ? (
                  <p>This saved revision is already published.</p>
                ) : manager ? (
                  <AnnouncementForm
                    ticketId={ticketId}
                    revision={draft.revision}
                    operation="publish"
                  >
                    <label className="communication-choice">
                      <input type="checkbox" name="confirm" value="yes" required />I reviewed this
                      saved message and approve showing it to everyone in the workspace.
                    </label>
                  </AnnouncementForm>
                ) : (
                  <p>Ask the coordinator or an administrator to approve publication.</p>
                )}
              </div>
            </details>
          )}
          {live && manager && draft && (
            <details>
              <summary>Remove announcement</summary>
              <p>Remove “{live.title}” from employee pages. Its publication history is retained.</p>
              <AnnouncementForm ticketId={ticketId} revision={draft.revision} operation="withdraw">
                <p>This removes only the notice; the ticket stays open.</p>
              </AnnouncementForm>
            </details>
          )}
        </>
      )}
    </section>
  );
}
