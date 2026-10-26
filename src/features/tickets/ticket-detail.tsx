import Link from 'next/link';
import { notFound } from 'next/navigation';

import { addTicketMessage, reopenTicket } from '@/app/app/tickets/actions';
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
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { SlaClock, SlaIndicator } from '@/features/tickets/sla-indicator';
import { SlaPolicy } from '@/features/tickets/sla-policy-table';
import { popularTags } from '@/features/tickets/tags';
import { TicketAssignmentEditor } from '@/features/tickets/ticket-details-form';
import { TicketTags } from '@/features/tickets/ticket-tags';
import { Timestamp } from '@/features/timezones/provider';
import { TicketProcedures } from '@/features/workflows/ticket-procedures';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { activityProfileIds, ActivityTimeline } from './activity-timeline';
import { IncidentPanel } from './incident-panel';
import { safeQueueReturn } from './queue-navigation';
import { ReopenTicketForm } from './reopen-ticket-form';
import { ReportedImpact } from './reported-impact';
import { TicketWorkflow } from './ticket-workflow';
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
    const [messagesR, attachmentsR] = await Promise.all([
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
    ]);
    const profiles = await profileLabels(
      supabase,
      viewer.organizationId,
      (messagesR.data ?? []).map((message) => message.author_id),
    );
    const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
    const paths = (attachmentsR.data ?? []).map((a) => a.storage_path);
    const { data: signed } = paths.length
      ? await supabase.storage.from('ticket-attachments').createSignedUrls(paths, 3600)
      : { data: [] };
    const urls = new Map((signed ?? []).map((v) => [v.path, v.signedUrl ?? undefined]));
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
            <Link className="button button-quiet page-back-link" href={back} scroll={false}>
              ← My requests
            </Link>
            <p className="portal-reference">Request #{employeeTicket.ticket_number}</p>
            <Heading>{employeeTicket.title}</Heading>
            <span className={`ticket-badge tone-${ticketStatuses[employeeTicket.status].tone}`}>
              {ticketStatuses[employeeTicket.status].label}
            </span>
          </div>
        </div>
        {canReopen && (
          <ReopenTicketForm
            key={employeeTicket.id}
            ticketId={employeeTicket.id}
            revision={employeeTicket.revision}
            action={reopenTicket}
          />
        )}
        {message.error && (
          <div className="alert alert-error page-alert" role="alert">
            {message.error}
          </div>
        )}
        {message.success && (
          <div className="alert alert-success page-alert" role="status">
            {message.success} Request #{employeeTicket.ticket_number} is saved here.
          </div>
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
              className="button button-quiet"
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
            <MessageComposer
              key={ticket.id}
              ticketId={ticket.id}
              action={addTicketMessage}
              staff={false}
            />
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
              className="button button-quiet"
              href={`/app/tickets/${ticket.id}/history?view=files`}
            >
              View all files
            </Link>
          </div>
          <p className="muted">Files are visible to you and IT support.</p>
          <AttachmentUpload
            organizationId={viewer.organizationId}
            ticketId={employeeTicket.id}
            userId={viewer.id}
          />
          {attachmentsR.error && (
            <p role="alert">
              Attachments could not load. <RetryButton />
            </p>
          )}
          <div className="attachment-list">
            {attachmentsR.data?.map((a) => (
              <a key={a.id} href={urls.get(a.storage_path)} target="_blank" rel="noreferrer">
                {a.file_name} · {Math.ceil(a.size_bytes / 1024)} KB
              </a>
            ))}
            {!attachmentsR.error && !attachmentsR.data?.length && (
              <p className="muted">No files attached.</p>
            )}
          </div>
        </section>
      </div>
    );
  }
  const [messagesR, attachmentsR, activityR, workflowR, savedRepliesR, tagsR, tagUsageR] =
    await Promise.all([
      supabase
        .from('ticket_messages')
        .select('id, author_id, author_type, automation_name, kind, body, created_at')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE),
      supabase
        .from('ticket_attachments')
        .select('id, file_name, storage_path, size_bytes, created_at')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE),
      supabase
        .from('ticket_activity')
        .select('id, actor_id, action, details, created_at')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE),
      supabase
        .from('ticket_workflows')
        .select('ticket_id')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .maybeSingle(),
      supabase
        .from('saved_replies')
        .select('id, title, body')
        .eq('organization_id', viewer.organizationId)
        .order('title')
        .order('id')
        .limit(200),
      supabase
        .from('ticket_tags')
        .select('tag')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .order('tag'),
      // Recent tag usage across the workspace, for consistent suggestions.
      supabase
        .from('ticket_tags')
        .select('tag')
        .eq('organization_id', viewer.organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
  const tags = (tagsR.data ?? []).map((row) => row.tag);
  const tagSuggestions = popularTags((tagUsageR.data ?? []).map((row) => row.tag));
  const profiles = await profileLabels(supabase, viewer.organizationId, [
    ticket.requester_id,
    ...(ticket.assigned_technician_id ? [ticket.assigned_technician_id] : []),
    ...(messagesR.data ?? []).map((row) => row.author_id),
    ...activityProfileIds(activityR.data ?? []),
  ]);
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  const paths = attachmentsR.data?.map((a) => a.storage_path) ?? [];
  const { data: signed } = paths.length
    ? await supabase.storage.from('ticket-attachments').createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((signed ?? []).map((v) => [v.path, v.signedUrl ?? undefined]));
  const activeWorkflow =
    ticket.ticket_type === 'incident' || Boolean(workflowR.data) || Boolean(workflowR.error);
  const coordination = ticket.request_kind !== 'inventory' && (
    <div className="ticket-coordination">
      <TicketProcedures organizationId={viewer.organizationId} ticketId={ticket.id} />
      <IncidentPanel
        organizationId={viewer.organizationId}
        ticketId={ticket.id}
        revision={ticket.revision}
        ownerId={viewer.id}
      />
    </div>
  );
  return (
    <div className="page">
      <div className="ticket-topbar">
        {!embedded && (
          <Link className="button button-quiet page-back-link" href={back} scroll={false}>
            ← Back to tickets
          </Link>
        )}
        <a className="button button-secondary" href="#ticket-assignment">
          Assignment &amp; details
        </a>
        <span>#{ticket.ticket_number}</span>
      </div>
      <header className="page-header ticket-heading">
        <div>
          <div className="ticket-heading-badges">
            {ticket.ticket_type === 'incident' && (
              <span className="ticket-badge tone-info">Incident</span>
            )}
            <span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>
              {ticketStatuses[ticket.status].label}
            </span>
            <span className={`ticket-badge tone-${ticketPriorities[ticket.priority].tone}`}>
              {ticketPriorities[ticket.priority].label}
            </span>
          </div>
          <Heading>{ticket.title}</Heading>
          <p>
            Requested by {names.get(ticket.requester_id) ?? 'Unknown'} ·{' '}
            <Timestamp value={ticket.created_at} />
          </p>
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
        <div className="alert alert-error page-alert" role="alert">
          {message.error}
        </div>
      )}
      {message.success && (
        <div className="alert alert-success page-alert" role="status">
          {message.success}
        </div>
      )}
      <TicketWorkflow
        key={ticket.id}
        status={ticket.status}
        assigned={Boolean(ticket.assigned_technician_id)}
        activeWorkflow={activeWorkflow}
        review={
          <>
            <section className="settings-card">
              <h3>Request from {names.get(ticket.requester_id) ?? 'the requester'}</h3>
              <p className="ticket-description">{ticket.description}</p>
              <ReportedImpact value={ticket.reported_impact} />
            </section>
            <TicketTags
              ticketId={ticket.id}
              tags={tags}
              suggestions={tagSuggestions}
              error={Boolean(tagsR.error)}
            />
            <InventoryRequestPanel ticketId={ticket.id} />
            <TicketAssets ticketId={ticket.id} />
            <section className="settings-card">
              <div className="section-heading-row">
                <h3>Attachments</h3>
                <Link
                  className="button button-quiet"
                  href={`/app/tickets/${ticket.id}/history?view=files`}
                >
                  View all files
                </Link>
              </div>
              <p className="muted">Files are visible to the requester and IT staff.</p>
              <AttachmentUpload
                organizationId={viewer.organizationId}
                ticketId={ticket.id}
                userId={viewer.id}
              />
              {attachmentsR.error && (
                <p role="alert">
                  Attachments could not load. <RetryButton />
                </p>
              )}
              <div className="attachment-list">
                {attachmentsR.data?.map((a) => (
                  <a key={a.id} href={urls.get(a.storage_path)} target="_blank" rel="noreferrer">
                    <strong>{a.file_name}</strong>
                    <span>
                      {Math.ceil(a.size_bytes / 1024)} KB · <Timestamp value={a.created_at} />
                    </span>
                  </a>
                ))}
                {!attachmentsR.error && !attachmentsR.data?.length && (
                  <p className="muted">No attachments.</p>
                )}
              </div>
            </section>
          </>
        }
        assignment={
          <>
            <TicketWorkActions
              ticket={ticket}
              stage="assignment"
              assignee={
                ticket.assigned_technician_id
                  ? (names.get(ticket.assigned_technician_id) ?? 'Assigned staff member')
                  : 'Unassigned'
              }
            />
            <section className="settings-card ticket-assignment">
              <h3>Choose a technician or team</h3>
              <p className="muted">
                Use Assign to me above, or choose another technician below and save the details.
              </p>
              <TicketAssignmentEditor key={ticket.id} ticket={ticket} timeZone={viewer.timeZone} />
            </section>
          </>
        }
        conversation={
          <>
            <section className="settings-card">
              <div className="section-heading-row">
                <h3>Conversation</h3>
                <Link
                  className="button button-quiet"
                  aria-label="View conversation history in a new tab"
                  href={`/app/tickets/${ticket.id}/history`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View history
                </Link>
              </div>
              {viewer.usageSharing && (
                <UsageEvent
                  key={ticketId}
                  event="ticket_viewed"
                  surface="tickets"
                  targetId={ticketId}
                />
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
                // Optional: if saved replies fail to load, the composer still works without them.
                savedReplies={savedRepliesR.error ? undefined : (savedRepliesR.data ?? [])}
                replyContext={{
                  requesterName: names.get(ticket.requester_id) ?? null,
                  agentName: viewer.displayName,
                  ticketNumber: ticket.ticket_number,
                }}
              />
            </section>
            <LinkedChatHistory
              ticketId={ticket.id}
              organizationId={viewer.organizationId}
              viewerId={viewer.id}
            />
          </>
        }
        resolution={
          <>
            <TicketWorkActions
              ticket={ticket}
              stage="resolution"
              assignee={
                ticket.assigned_technician_id
                  ? (names.get(ticket.assigned_technician_id) ?? 'Assigned staff member')
                  : 'Unassigned'
              }
            />
            <section className="settings-card">
              <h3>Service levels</h3>
              <SlaClock initialNow={new Date().getTime()}>
                <SlaIndicator ticket={ticket} />
              </SlaClock>
              <p className="muted">
                Calendar hours · Includes nights and weekends. Waiting and on-hold time counts.
              </p>
              <details>
                <summary>SLA targets</summary>
                <SlaPolicy />
                <p className="muted">
                  Priority changes adjust unfinished targets from creation. Reopening resumes the
                  original resolution deadline.
                </p>
              </details>
            </section>
          </>
        }
        tools={coordination}
        history={
          <section className="settings-card activity">
            <h3>Recent activity</h3>
            <Link
              className="button button-secondary"
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
        }
      />
    </div>
  );
}
