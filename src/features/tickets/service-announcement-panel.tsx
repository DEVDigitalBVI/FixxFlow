import { randomUUID } from 'node:crypto';

import { RetryButton } from '@/components/ui/retry-button';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { announcementStatus } from './announcement-status';
import { AnnouncementEditor, AnnouncementForm } from './service-announcement-forms';

export async function ServiceAnnouncementPanel({
  organizationId,
  ticketId,
}: {
  organizationId: string;
  ticketId: string;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || viewer.organizationId !== organizationId) return null;
  const db = await createClient();
  const [draftResult, liveResult, ticketResult, workflowResult] = await Promise.all([
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
      .select('status,assigned_technician_id')
      .eq('organization_id', organizationId)
      .eq('id', ticketId)
      .maybeSingle(),
    db
      .from('ticket_workflows')
      .select('owner_id')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .maybeSingle(),
  ]);
  if ([draftResult, liveResult, ticketResult, workflowResult].some((r) => r.error))
    return (
      <section
        id="employee-announcement"
        className="settings-card stack"
        aria-label="Employee announcement"
      >
        <h2>Employee announcement</h2>
        <p role="alert">
          The announcement could not load. <RetryButton />
        </p>
      </section>
    );
  const draft = draftResult.data,
    live = liveResult.data,
    manager =
      viewer.role === 'administrator' ||
      viewer.id === ticketResult.data?.assigned_technician_id ||
      viewer.id === workflowResult.data?.owner_id,
    terminal = ['resolved', 'closed'].includes(ticketResult.data?.status ?? 'closed');
  const editor = (
    <AnnouncementEditor
      ticketId={ticketId}
      revision={draft?.revision ?? 0}
      title={draft?.title ?? live?.title ?? ''}
      body={draft?.body ?? live?.body ?? ''}
      update={!!live}
      requestKey={randomUUID()}
      details={draft ?? live ?? undefined}
      timeZone={viewer.timeZone}
    />
  );
  return (
    <section
      id="employee-announcement"
      className="settings-card stack"
      aria-labelledby="employee-announcement-heading"
    >
      <h2 id="employee-announcement-heading">Employee announcement</h2>
      {live && (
        <div>
          <h3>{live.title}</h3>
          <span className={`ticket-badge tone-${announcementStatus(live.public_status).tone}`}>
            {announcementStatus(live.public_status).label}
          </span>
          <p className="ticket-description">{live.body}</p>
          {live.workaround && <p>What to do: {live.workaround}</p>}
          <p className="muted">
            Updated <Timestamp value={live.published_at} />
            {live.next_update_at && (
              <>
                {' '}
                · Next update <Timestamp value={live.next_update_at} />
              </>
            )}
          </p>
        </div>
      )}
      {terminal ? (
        <p className="muted">Reopen this ticket to publish an announcement.</p>
      ) : !manager ? (
        <p className="muted">
          The assigned technician, coordinator or an administrator can publish an announcement.
        </p>
      ) : live ? (
        <>
          <details>
            <summary>Edit announcement</summary>
            {editor}
          </details>
          <details>
            <summary>Remove announcement</summary>
            <p>Removes this notice from home pages. Emails already sent cannot be recalled.</p>
            <AnnouncementForm
              ticketId={ticketId}
              revision={draft?.revision ?? 0}
              operation="withdraw"
            />
          </details>
        </>
      ) : (
        editor
      )}
    </section>
  );
}
