import Link from 'next/link';
import { notFound } from 'next/navigation';

import { addTicketMessage, reopenTicket, replyAndSetStatus } from '@/app/app/tickets/actions';
import { RetryButton } from '@/components/ui/retry-button';
import { TicketAssets } from '@/features/assets/ticket-assets';
import { LinkedChatHistory } from '@/features/chat/linked-chat-history';
import { HISTORY_PAGE_SIZE, recentMessages } from '@/features/conversations/history';
import { inventoryAccess } from '@/features/inventory/access';
import { InventoryRequestPanel } from '@/features/inventory/request-panel';
import { profileLabels } from '@/features/lookups/labels';
import { UsageEvent } from '@/features/product-analytics/usage-event';
import { AttachmentUpload } from '@/features/tickets/attachment-upload';
import { ConversationRefresh } from '@/features/tickets/conversation-refresh';
import { ConversationTimeline } from '@/features/tickets/conversation-timeline';
import { MessageComposer } from '@/features/tickets/message-composer';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';

import '@/features/tickets/presentation';

import { Suspense } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { IncidentFollowers } from '@/features/tickets/incident-followers';
import { SlaClock, SlaIndicator } from '@/features/tickets/sla-indicator';
import { SlaPolicy } from '@/features/tickets/sla-policy-table';
import { TicketAssignmentEditor } from '@/features/tickets/ticket-details-form';
import { TicketLinks, type LinkedTicket } from '@/features/tickets/ticket-links';
import { TicketTags } from '@/features/tickets/ticket-tags';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { scheduleDescription } from './organization-sla';
import { safeQueueReturn } from './queue-navigation';
import { rateResolution } from './rating-actions';
import { ratingWindowOpen } from './ratings';
import { ReopenTicketForm } from './reopen-ticket-form';
import { ReportedImpact } from './reported-impact';
import { RequestExpectations } from './request-expectations';
import { ResolutionRating } from './resolution-rating';
import { TicketAttachmentList, ticketAttachmentUrls } from './ticket-attachment-list';
import { TicketMutationProvider } from './ticket-mutation-state';
import { TicketPanel } from './ticket-panel';
import {
  TicketActivity,
  TicketCoordination,
  TicketCoordinationBadge,
  TicketFileCount,
  TicketFiles,
  TicketRatings,
  TicketWatcherDetails,
} from './ticket-secondary-panels';
import { TicketWorkspace } from './ticket-workspace';
import { TicketWorkActions } from './work-actions';

export async function TicketDetail({
  ticketId,
  message = {},
  embedded = false,
}: {
  ticketId: string;
  message?: { error?: string; success?: string; returnTo?: string };
  embedded?: boolean;
}) {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const back = safeQueueReturn(message.returnTo);
  const Heading = embedded ? 'h2' : 'h1';
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('id', ticketId)
    .maybeSingle();
  if (embedded && (ticketError || !ticket))
    return (
      <div className="page">
        <p role="alert">
          {ticketError
            ? 'Ticket could not load. Try again or close this panel to continue in the queue.'
            : 'This ticket is unavailable. Close this panel to continue in the queue.'}
        </p>
        {ticketError && <RetryButton />}
      </div>
    );
  if (ticketError) throw new Error('Ticket could not be loaded. Please try again.');
  if (!ticket) notFound();
  if (
    viewer.role === 'end_user' &&
    ticket.requester_id !== viewer.id &&
    !(ticket.request_kind === 'inventory' && (await inventoryAccess(viewer)).manager)
  )
    notFound();
  if (viewer.role === 'end_user') {
    const employeeTicket = ticket;
    const resolvedCycle =
      (ticket.status === 'resolved' || ticket.status === 'closed') && ticket.resolved_at;
    const [messagesR, attachmentsR, ratingR] = await Promise.all([
      supabase
        .from('ticket_messages')
        .select('id, author_id, author_type, automation_name, kind, body, created_at')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .eq('kind', 'reply')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE),
      supabase
        .from('ticket_attachments')
        .select('id, file_name, storage_path, size_bytes')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE),
      resolvedCycle
        ? supabase
            .from('ticket_resolution_ratings')
            .select('score, comment')
            .eq('organization_id', viewer.organizationId)
            .eq('ticket_id', ticketId)
            .eq('resolved_at', resolvedCycle)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const profiles = await profileLabels(
      supabase,
      viewer.organizationId,
      (messagesR.data ?? []).map((message) => message.author_id),
    );
    const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
    const paths = (attachmentsR.data ?? []).map((a) => a.storage_path);
    const urls = await ticketAttachmentUrls(supabase, paths);
    const canReopen =
      employeeTicket.requester_id === viewer.id &&
      (employeeTicket.status === 'resolved' || employeeTicket.status === 'closed');
    return (
      <div className="portal-page portal-detail">
        {viewer.usageSharing && (
          <UsageEvent key={ticketId} event="ticket_viewed" surface="tickets" targetId={ticketId} />
        )}
        <ConversationRefresh />
        <div className="portal-page-heading">
          <div>
            <Link
              className={buttonVariants({ variant: 'quiet', className: 'page-back-link' })}
              href={back}
              scroll={false}
            >
              <NavigationIcon name="arrowLeft" className="inline-icon" size={16} />
              My requests
            </Link>
            <p className="portal-reference">Request #{employeeTicket.ticket_number}</p>
            <Heading>{employeeTicket.title}</Heading>
            <TicketStatusBadge status={employeeTicket.status} />
          </div>
        </div>
        <SlaClock initialNow={new Date().getTime()}>
          <RequestExpectations ticket={employeeTicket} />
        </SlaClock>
        {canReopen && !ratingR.error && (
          <ResolutionRating
            key={`${employeeTicket.id}:${employeeTicket.resolved_at}`}
            ticketId={employeeTicket.id}
            rating={ratingR.data}
            canRate={ratingWindowOpen(employeeTicket.resolved_at, new Date().getTime())}
            action={rateResolution}
          />
        )}
        {canReopen && (
          <ReopenTicketForm
            key={employeeTicket.id}
            ticketId={employeeTicket.id}
            revision={employeeTicket.revision}
            action={reopenTicket}
          />
        )}
        {message.error && (
          <Alert tone="error" className="page-alert" role="alert">
            {message.error}
          </Alert>
        )}
        {message.success && (
          <Alert tone="success" className="page-alert" role="status">
            {message.success} Request #{employeeTicket.ticket_number} is saved here.
          </Alert>
        )}
        <InventoryRequestPanel ticketId={ticket.id} />
        <section className="portal-detail-card">
          <h2>Your request</h2>
          <p className="ticket-description">{employeeTicket.description}</p>
          <ReportedImpact value={employeeTicket.reported_impact} />
          <p className="muted">
            Sent <Timestamp value={employeeTicket.created_at} />
          </p>
        </section>
        <section className="portal-detail-card">
          <div className="section-heading-row">
            <h2>Conversation</h2>
            <Link
              className={buttonVariants({ variant: 'quiet' })}
              aria-label="View conversation history in a new tab"
              href={`/app/tickets/${ticket.id}/history`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View history
            </Link>
          </div>
          <ConversationTimeline
            messages={recentMessages(messagesR.data ?? [])}
            names={names}
            viewerId={viewer.id}
            requesterId={ticket.requester_id}
            staff={false}
            error={!!messagesR.error}
          />
          {canReopen ? (
            <p className="muted">
              Use Reopen ticket above to continue this request if the same issue remains.
            </p>
          ) : (
            <>
              <MessageComposer
                key={ticket.id}
                ticketId={ticket.id}
                action={addTicketMessage}
                staff={false}
              />
              <div className="portal-reply-attach">
                <span className="muted">Add a screenshot or file for IT:</span>
                <AttachmentUpload
                  organizationId={viewer.organizationId}
                  ticketId={employeeTicket.id}
                  userId={viewer.id}
                />
              </div>
            </>
          )}
        </section>
        <LinkedChatHistory
          ticketId={employeeTicket.id}
          organizationId={viewer.organizationId}
          viewerId={viewer.id}
        />
        <section className="portal-detail-card">
          <div className="section-heading-row">
            <h2>Attachments</h2>
            <Link
              className={buttonVariants({ variant: 'quiet' })}
              href={`/app/tickets/${ticket.id}/history?view=files`}
            >
              View all files
            </Link>
          </div>
          <p className="muted">Files are visible to you and IT support.</p>
          {canReopen && (
            <AttachmentUpload
              organizationId={viewer.organizationId}
              ticketId={employeeTicket.id}
              userId={viewer.id}
            />
          )}
          <TicketAttachmentList
            files={attachmentsR.data ?? []}
            urls={urls}
            error={!!attachmentsR.error}
          />
        </section>
      </div>
    );
  }
  const [messagesR, tagsR, linksR] = await Promise.all([
    supabase
      .from('ticket_messages')
      .select('id, author_id, author_type, automation_name, kind, body, created_at')
      .eq('organization_id', viewer.organizationId)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_PAGE_SIZE),
    supabase
      .from('ticket_tags')
      .select('tag')
      .eq('organization_id', viewer.organizationId)
      .eq('ticket_id', ticketId)
      .order('tag'),
    supabase
      .from('ticket_links')
      .select(
        'ticket_id, linked_ticket_id, kind, source:tickets!ticket_links_organization_id_ticket_id_fkey(id, ticket_number, title, status), target:tickets!ticket_links_organization_id_linked_ticket_id_fkey(id, ticket_number, title, status)',
      )
      .eq('organization_id', viewer.organizationId)
      .or(`ticket_id.eq.${ticket.id},linked_ticket_id.eq.${ticket.id}`),
  ]);
  const tags = (tagsR.data ?? []).map((row) => row.tag);
  const links: LinkedTicket[] = (linksR.data ?? []).flatMap((row) => {
    const outgoing = row.ticket_id === ticket.id;
    const other = outgoing ? row.target : row.source;
    return other
      ? [
          {
            id: other.id,
            number: other.ticket_number,
            title: other.title,
            status: other.status,
            relation: row.kind === 'related' ? 'related' : outgoing ? 'main' : 'duplicate',
          },
        ]
      : [];
  });
  const mainTicket = links.find((link) => link.relation === 'main');
  const profiles = await profileLabels(supabase, viewer.organizationId, [
    ticket.requester_id,
    ...(ticket.assigned_technician_id ? [ticket.assigned_technician_id] : []),
    ...(messagesR.data ?? []).map((row) => row.author_id),
  ]);
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  const assignee = ticket.assigned_technician_id
    ? (names.get(ticket.assigned_technician_id) ?? 'Assigned staff member')
    : 'Unassigned';
  const identity = (
    <>
      <header className="page-header ticket-heading">
        <div>
          <div className="ticket-heading-badges">
            {ticket.ticket_type === 'incident' && (
              <Badge tone="info" className="ticket-badge">
                Incident
              </Badge>
            )}
            <TicketStatusBadge status={ticket.status} />
            <TicketStatusBadge priority={ticket.priority} />
          </div>
          <Heading>{ticket.title}</Heading>
          <p>
            Requested by {names.get(ticket.requester_id) ?? 'Unknown'} ·{' '}
            <Timestamp value={ticket.created_at} />
          </p>
          {mainTicket && (
            <p className="ticket-heading-duplicate">
              Duplicate of{' '}
              <Link href={`/app/tickets/${mainTicket.id}`}>
                #{mainTicket.number} {mainTicket.title}
              </Link>
            </p>
          )}
          {tags.length > 0 && (
            <p className="ticket-heading-tags">
              <span className="sr-only">Tags: </span>
              {tags.map((tag) => (
                <span key={tag} className="ticket-tag">
                  {tag}
                </span>
              ))}
            </p>
          )}
        </div>
      </header>
      {message.error && (
        <Alert tone="error" className="page-alert" role="alert">
          {message.error}
        </Alert>
      )}
      {message.success && (
        <Alert tone="success" className="page-alert" role="status">
          {message.success}
        </Alert>
      )}
    </>
  );
  const request = (
    <section className="settings-card">
      <h3>Request from {names.get(ticket.requester_id) ?? 'the requester'}</h3>
      <p className="ticket-description">{ticket.description}</p>
      <ReportedImpact value={ticket.reported_impact} />
      {!embedded && (
        <a href="#ticket-files">
          <Suspense fallback="View files">
            <TicketFileCount organizationId={viewer.organizationId} ticketId={ticket.id} />
          </Suspense>
        </a>
      )}
    </section>
  );
  const conversation = (
    <section className="settings-card" id={embedded ? 'ticket-conversation' : undefined}>
      <div className="section-heading-row">
        <h3>Conversation</h3>
        <Link
          className={buttonVariants({ variant: 'quiet' })}
          aria-label="View conversation history in a new tab"
          href={`/app/tickets/${ticket.id}/history`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View history
        </Link>
      </div>
      {viewer.usageSharing && (
        <UsageEvent key={ticketId} event="ticket_viewed" surface="tickets" targetId={ticketId} />
      )}
      <ConversationRefresh />
      <ConversationTimeline
        messages={recentMessages(messagesR.data ?? [])}
        names={names}
        viewerId={viewer.id}
        requesterId={ticket.requester_id}
        staff
        error={!!messagesR.error}
      />
      <MessageComposer
        key={ticket.id}
        ticketId={ticket.id}
        action={addTicketMessage}
        statusAction={replyAndSetStatus}
        revision={ticket.revision}
        ticketStatus={ticket.status}
        lazySavedReplies
        replyContext={{
          requesterName: names.get(ticket.requester_id) ?? null,
          agentName: viewer.displayName,
          ticketNumber: ticket.ticket_number,
        }}
      />
    </section>
  );
  if (embedded)
    return (
      <TicketMutationProvider key={ticket.id}>
        <div className="page ticket-drawer-summary">
          <p className="ticket-drawer-number muted">#{ticket.ticket_number}</p>
          {identity}
          <SlaClock initialNow={new Date().getTime()}>
            <SlaIndicator ticket={ticket} compact />
          </SlaClock>
          <div id="ticket-status" tabIndex={-1}>
            <TicketWorkActions key={ticket.id} ticket={ticket} stage="all" assignee={assignee} />
          </div>
          {request}
          {conversation}
        </div>
      </TicketMutationProvider>
    );
  return (
    <div className="page">
      <div className="ticket-topbar">
        <Link
          className={buttonVariants({ variant: 'quiet', className: 'page-back-link' })}
          href={back}
          scroll={false}
        >
          <NavigationIcon name="arrowLeft" className="inline-icon" size={16} />
          Back to tickets
        </Link>
        <div className="ticket-topbar-actions">
          <a className={buttonVariants({ variant: 'secondary' })} href="#ticket-assignment">
            Assignment &amp; details
          </a>
          <span>#{ticket.ticket_number}</span>
        </div>
      </div>
      {identity}
      <TicketMutationProvider key={ticket.id}>
        <TicketWorkspace
          key={ticket.id}
          review={request}
          coordinationSection={
            ticket.request_kind !== 'inventory' ? (
              <TicketPanel
                label="Coordination"
                load={() => TicketCoordination({ ticket, viewer })}
              />
            ) : undefined
          }
          files={
            <TicketPanel label="Files" load={() => TicketFiles({ ticketId: ticket.id, viewer })} />
          }
          details={
            <>
              <TicketAssignmentEditor
                key={ticket.id}
                ticket={ticket}
                timeZone={viewer.timeZone}
                disclosure
              />
              <details className="ticket-disclosure">
                <summary>
                  {tagsR.error
                    ? 'Tags · Unavailable'
                    : tags.length
                      ? `Tags · ${tags.join(', ')}`
                      : 'Add tags'}
                </summary>
                <TicketTags ticketId={ticket.id} tags={tags} error={Boolean(tagsR.error)} />
              </details>
              <details className="ticket-disclosure">
                <summary>
                  {linksR.error
                    ? 'Links · Unavailable'
                    : links.length
                      ? `Links · ${links.map((link) => `#${link.number}`).join(', ')}`
                      : 'Add links'}
                </summary>
                <TicketLinks
                  ticketId={ticket.id}
                  revision={ticket.revision}
                  status={ticket.status}
                  links={links}
                  error={Boolean(linksR.error)}
                />
              </details>
              {ticket.ticket_type === 'incident' && (
                <details className="ticket-disclosure">
                  <summary>Incident followers</summary>
                  <TicketPanel
                    label="Incident followers"
                    load={() => IncidentFollowers({ ticketId: ticket.id })}
                  />
                </details>
              )}
              <TicketPanel
                label="Watchers"
                load={() => TicketWatcherDetails({ ticketId: ticket.id, viewer })}
              />
              {ticket.request_kind === 'inventory' && (
                <details className="ticket-disclosure">
                  <summary>Inventory request</summary>
                  <TicketPanel
                    label="Inventory request"
                    load={() => InventoryRequestPanel({ ticketId: ticket.id })}
                  />
                </details>
              )}
              <TicketPanel
                label="Assets"
                load={() => TicketAssets({ ticketId: ticket.id, compact: true })}
              />
            </>
          }
          assignment={
            <>
              <TicketWorkActions ticket={ticket} stage="all" assignee={assignee} compact />
              <p>
                Priority: <TicketStatusBadge priority={ticket.priority} />{' '}
                <a href="#ticket-assignment">Edit details</a>
              </p>
              <SlaClock initialNow={new Date().getTime()}>
                <SlaIndicator ticket={ticket} compact />
              </SlaClock>
              {ticket.request_kind !== 'inventory' && (
                <Suspense fallback={null}>
                  <TicketCoordinationBadge ticket={ticket} organizationId={viewer.organizationId} />
                </Suspense>
              )}
            </>
          }
          conversation={
            <>
              {conversation}
              <TicketPanel
                label="Linked chat"
                load={() =>
                  LinkedChatHistory({
                    ticketId: ticket.id,
                    organizationId: viewer.organizationId,
                    viewerId: viewer.id,
                  })
                }
              />
            </>
          }
          resolution={
            <>
              <section className="settings-card">
                <h3>Service levels</h3>
                <SlaClock initialNow={new Date().getTime()}>
                  <SlaIndicator ticket={ticket} />
                  <p className="muted">
                    Acknowledgment:{' '}
                    {ticket.acknowledged_at ? (
                      <Timestamp value={ticket.acknowledged_at} />
                    ) : (
                      'No acknowledgment recorded'
                    )}
                    . Work starting records acknowledgment; public replies record requester
                    communication.
                  </p>
                </SlaClock>
                <p className="muted">
                  {ticket.sla_timezone
                    ? `Support hours: ${scheduleDescription(ticket.sla_schedule)} (${ticket.sla_timezone}). Both clocks stop outside working hours. Waiting on user and documented holds pause resolution only. Earlier breaches remain recorded. For technicians handling their own request, starting work counts as response acknowledgment.`
                    : 'Completed under the previous calendar-hours policy. Historical SLA results are preserved.'}
                </p>
                <details>
                  <summary>SLA targets</summary>
                  <SlaPolicy targets={ticket.sla_targets} schedule={ticket.sla_schedule} />
                  <p className="muted">
                    Priority changes adjust unfinished targets from creation. Reopening resumes the
                    existing resolution target, including recorded waiting pauses. A requester reply
                    resumes waiting tickets automatically.
                  </p>
                </details>
              </section>
              <TicketPanel
                label="Requester rating"
                load={() => TicketRatings({ ticket, viewer })}
              />
            </>
          }
          history={
            <TicketPanel
              label="Activity"
              load={() => TicketActivity({ ticketId: ticket.id, viewer })}
            />
          }
        />
      </TicketMutationProvider>
    </div>
  );
}
