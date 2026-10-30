import Link from 'next/link';
import { notFound } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RetryButton } from '@/components/ui/retry-button';
import { isUuid } from '@/features/tickets/communications';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function IncidentUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer(),
    { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await createClient();
  const { data, error } = await db
    .from('incident_bulletins')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error)
    return (
      <div className="page page-narrow">
        <PageHeader title="Incident update" />
        <p role="alert">
          This update could not load. <RetryButton />
        </p>
      </div>
    );
  if (!data) notFound();
  return (
    <div className={`page page-narrow${viewer.role === 'end_user' ? ' portal-detail' : ''}`}>
      <PageHeader
        title={data.title}
        eyebrow="Approved IT update"
        description="A message from your IT team."
      />
      <article className="settings-card stack" aria-label="Approved stakeholder message">
        <p className="muted">
          Published <Timestamp value={data.approved_at} />
        </p>
        <p className="ticket-description">{data.body}</p>
        <p>
          Next update expected: <Timestamp value={data.next_update_at} />
        </p>
      </article>
      <div className="section-heading-row">
        <Link className={buttonVariants({ variant: 'secondary' })} href="/app/notifications">
          Back to notifications
        </Link>
        {viewer.role !== 'end_user' && (
          <Link
            className={buttonVariants({ variant: 'secondary' })}
            href={`/app/tickets/${data.ticket_id}#communication-plan`}
          >
            Open coordination
          </Link>
        )}
      </div>
    </div>
  );
}
