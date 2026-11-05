import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { requireInsightAccess } from '@/features/support-viewer/access';
import { isSharedFeed } from '@/features/support-viewer/model';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

export default async function SharedIncidentPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const viewer = await requireViewer();
  await requireInsightAccess(viewer, 'sharedIncidents');
  const { ticketId } = await params;
  if (!isUuid(ticketId)) notFound();
  const db = await createClient();
  const { data, error } = await db.rpc('shared_incidents', {
    org: viewer.organizationId,
    ticket: ticketId,
  });
  if (error?.code === '42501') notFound();
  if (error || !isSharedFeed(data))
    throw new Error('This shared incident could not load. Please try again.');
  const row = data.rows[0];
  if (!row) notFound();
  return (
    <div className="page stack page-narrow">
      <PageHeader
        title={row.title}
        eyebrow={`Shared ${row.ticket_type === 'incident' ? 'incident' : 'priority ticket'} #${row.ticket_number}`}
        description="An approved summary from your IT team."
        back={{ href: '/app/shared-incidents', label: 'Back to shared incidents' }}
      />
      <div className="section-heading-row">
        <Badge tone="neutral">View only</Badge>
        <TicketStatusBadge status={row.status} />
        <TicketStatusBadge priority={row.priority} />
        {!row.published && <Badge tone="neutral">Private draft · Staff preview</Badge>}
      </div>
      <section className="settings-card stack">
        <h2>Overview</h2>
        <p className="ticket-description">{row.overview}</p>
      </section>
      <section className="settings-card stack">
        <h2>Resolution summary</h2>
        <p className="ticket-description">
          {row.resolution || 'IT has not published a resolution summary yet.'}
        </p>
      </section>
      <p className="muted">
        Summary updated <Timestamp value={row.updated_at} />. Status and priority reflect the
        current ticket.
      </p>
    </div>
  );
}
