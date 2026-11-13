import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { RetryButton } from '@/components/ui/retry-button';
import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import { profileLabels } from '@/features/lookups/labels';
import { IncidentSharingPanel } from '@/features/support-viewer/sharing-panel';
import { Timestamp } from '@/features/timezones/provider';
import { TicketProcedures } from '@/features/workflows/ticket-procedures';
import { requireViewer, type Viewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

import { activityProfileIds, ActivityTimeline } from './activity-timeline';
import { AttachmentUpload } from './attachment-upload';
import { IncidentPanel } from './incident-panel';
import { describeRating, ratingWindowOpen } from './ratings';
import { ServiceAnnouncementPanel } from './service-announcement-panel';
import { TicketAttachmentList, ticketAttachmentUrls } from './ticket-attachment-list';
import { loadTicketFiles, loadTicketWorkflow } from './ticket-loaders';
import { TicketPanel } from './ticket-panel';
import { TicketWatchers } from './ticket-watchers';

type Ticket = Database['public']['Tables']['tickets']['Row'];
async function staffClient(viewer: Viewer) {
  const current = await requireViewer();
  if (current.role === 'end_user' || current.organizationId !== viewer.organizationId)
    throw new Error('Staff access required');
  return createClient();
}

export async function TicketFiles({ ticketId, viewer }: { ticketId: string; viewer: Viewer }) {
  const db = await staffClient(viewer);
  const attachmentsR = await loadTicketFiles(viewer.organizationId, ticketId);
  const urls = await ticketAttachmentUrls(
    db,
    (attachmentsR.data ?? []).map((row) => row.storage_path),
  );
  return (
    <section className="settings-card">
      <div className="section-heading-row">
        <h3>Attachments</h3>
        <Link
          className={buttonVariants({ variant: 'quiet' })}
          href={`/app/tickets/${ticketId}/history?view=files`}
        >
          View all files
        </Link>
      </div>
      <p className="muted">Files are visible to the requester and IT staff.</p>
      <AttachmentUpload
        organizationId={viewer.organizationId}
        ticketId={ticketId}
        userId={viewer.id}
      />
      <TicketAttachmentList
        files={attachmentsR.data ?? []}
        urls={urls}
        error={!!attachmentsR.error}
        staff
      />
    </section>
  );
}

export async function TicketFileCount({
  organizationId,
  ticketId,
}: {
  organizationId: string;
  ticketId: string;
}) {
  try {
    const result = await loadTicketFiles(organizationId, ticketId);
    return result.error ? 'View files' : `${result.data?.length ?? 0} attachments`;
  } catch (error) {
    unstable_rethrow(error);
    return 'View files';
  }
}
export async function TicketActivity({ ticketId, viewer }: { ticketId: string; viewer: Viewer }) {
  const db = await staffClient(viewer);
  const ticket = { id: ticketId };
  const activityR = await db
    .from('ticket_activity')
    .select('id, actor_id, action, details, created_at')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE);
  const profiles = await profileLabels(
    db,
    viewer.organizationId,
    activityProfileIds(activityR.data ?? []),
  );
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  return (
    <section className="settings-card activity">
      <h3>Recent activity</h3>
      <Link
        className={buttonVariants({ variant: 'secondary' })}
        href={`/app/tickets/${ticket.id}/history?view=activity`}
      >
        Browse all activity
      </Link>
      {activityR.error && (
        <p role="alert">
          Activity could not load. <RetryButton />
        </p>
      )}
      {!activityR.error && !activityR.data?.length && (
        <p className="muted">No activity recorded yet.</p>
      )}
      {Boolean(activityR.data?.length) && (
        <ActivityTimeline items={activityR.data ?? []} names={names} />
      )}
    </section>
  );
}
export async function TicketRatings({ ticket, viewer }: { ticket: Ticket; viewer: Viewer }) {
  const db = await staffClient(viewer);
  const ratingsR = await db
    .from('ticket_resolution_ratings')
    .select('id, score, comment, resolved_at, updated_at')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticket.id)
    .order('resolved_at', { ascending: false })
    .limit(5);
  return (
    <>
      {' '}
      {(ratingsR.error || Boolean(ratingsR.data?.length) || ticket.resolved_at) && (
        <section
          className="settings-card requester-ratings"
          aria-labelledby="requester-rating-heading"
        >
          <h3 id="requester-rating-heading">Requester rating</h3>
          {ratingsR.error ? (
            <p role="alert">
              Ratings could not load. <RetryButton />
            </p>
          ) : ratingsR.data?.length ? (
            <ul className="requester-rating-list">
              {ratingsR.data.map((rating) => (
                <li key={rating.id}>
                  <strong>{describeRating(rating.score)}</strong>
                  <span className="muted">
                    {rating.resolved_at === ticket.resolved_at
                      ? 'Current resolution'
                      : 'Earlier resolution'}{' '}
                    · rated <Timestamp value={rating.updated_at} />
                  </span>
                  {rating.comment && <p className="requester-rating-comment">{rating.comment}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {ratingWindowOpen(ticket.resolved_at, new Date().getTime())
                ? 'No rating yet. The requester can rate this resolution for 30 days after it is resolved.'
                : 'The requester did not rate this resolution.'}
            </p>
          )}
        </section>
      )}
    </>
  );
}
export async function TicketWatcherDetails({
  ticketId,
  viewer,
}: {
  ticketId: string;
  viewer: Viewer;
}) {
  const db = await staffClient(viewer);
  const result = await db
    .from('ticket_watchers')
    .select('user_id')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId)
    .order('created_at');
  const ids = (result.data ?? []).map((row) => row.user_id);
  const profiles = await profileLabels(db, viewer.organizationId, ids);
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  return (
    <details className="ticket-disclosure">
      <summary>
        {result.error
          ? 'Watchers · Unavailable'
          : ids.length
            ? `Watchers · ${ids.map((id) => names.get(id) ?? 'Staff member').join(', ')}`
            : 'Add watchers'}
      </summary>
      <TicketWatchers
        ticketId={ticketId}
        viewerId={viewer.id}
        admin={viewer.role === 'administrator'}
        watchers={ids.map((userId) => ({ userId, name: names.get(userId) ?? 'Staff member' }))}
        error={Boolean(result.error)}
      />
    </details>
  );
}
export async function TicketCoordinationBadge({
  ticket,
  organizationId,
}: {
  ticket: Ticket;
  organizationId: string;
}) {
  let active = ticket.ticket_type === 'incident';
  try {
    const workflow = await loadTicketWorkflow(organizationId, ticket.id);
    active = active || Boolean(workflow.data) || Boolean(workflow.error);
  } catch (error) {
    unstable_rethrow(error);
  }
  return active ? <a href="#ticket-workflow-tools">Coordination · Active</a> : null;
}
export async function TicketCoordination({ ticket, viewer }: { ticket: Ticket; viewer: Viewer }) {
  const workflow = await loadTicketWorkflow(viewer.organizationId, ticket.id);
  const active =
    ticket.ticket_type === 'incident' || Boolean(workflow.data) || Boolean(workflow.error);
  return (
    <details className="ticket-disclosure" id="ticket-workflow-tools" open={active || undefined}>
      <summary>Coordination{active ? ' · Active' : ''}</summary>
      <div className="ticket-coordination">
        <TicketPanel
          label="Employee announcement"
          load={() =>
            ServiceAnnouncementPanel({
              organizationId: viewer.organizationId,
              ticketId: ticket.id,
              ticket,
            })
          }
        />
        <TicketPanel
          label="Incident coordination"
          load={() =>
            IncidentPanel({
              organizationId: viewer.organizationId,
              ticketId: ticket.id,
              revision: ticket.revision,
              ownerId: viewer.id,
              isIncident: ticket.ticket_type === 'incident',
            })
          }
        />
        <TicketPanel
          label="Shared incident summary"
          load={() =>
            IncidentSharingPanel({
              organizationId: viewer.organizationId,
              ticketId: ticket.id,
              eligible:
                ticket.ticket_type === 'incident' || ['high', 'critical'].includes(ticket.priority),
            })
          }
        />
        <TicketPanel
          label="Ticket procedures"
          load={() =>
            TicketProcedures({ organizationId: viewer.organizationId, ticketId: ticket.id })
          }
        />
      </div>
    </details>
  );
}
