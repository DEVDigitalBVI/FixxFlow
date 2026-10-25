import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/ui/page-header';
import { EmployeeHome } from '@/features/portal/employee-home';
import { ReportUnavailable, TodayMetrics } from '@/features/reporting/components';
import { getReport } from '@/features/reporting/data';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function OverviewPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') {
    const supabase = await createClient();
    const { data: recent } = await supabase
      .from('tickets')
      .select('id, ticket_number, title, status, updated_at')
      .eq('organization_id', viewer.organizationId)
      .eq('requester_id', viewer.id)
      .order('updated_at', { ascending: false })
      .limit(3);
    const hour = Number(
      new Intl.DateTimeFormat('en', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: viewer.timeZone,
      }).format(new Date()),
    );
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return (
      <EmployeeHome
        firstName={viewer.displayName.split(' ')[0]}
        greeting={greeting}
        organizationName={viewer.organizationName}
        recent={recent ?? []}
        timeZone={viewer.timeZone}
      />
    );
  }
  return (
    <div className="page overview-page">
      <PageHeader
        title="Support dashboard"
        eyebrow={viewer.organizationName}
        description="Today’s activity and the work that needs attention."
        actions={
          <Link className="button button-primary" href="/app/tickets">
            Open ticket queue
          </Link>
        }
      />
      <Suspense fallback={<TodayMetrics report={null} />}>
        <OverviewMetrics organizationId={viewer.organizationId} />
      </Suspense>
      <section className="overview-work" aria-labelledby="overview-work-heading">
        <div className="overview-section-heading">
          <div>
            <h2 id="overview-work-heading">Work queues</h2>
            <p>Choose the work that needs attention.</p>
          </div>
          <Link className="button button-secondary" href="/app/reports">
            View reports &amp; trends <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <nav className="overview-queues" aria-label="Support shortcuts">
          {[
            {
              href: '/app/tickets?view=mine',
              title: 'My assigned tickets',
              description: 'Continue the work you own',
            },
            {
              href: '/app/tickets?view=unassigned',
              title: 'Unassigned tickets',
              description: 'Find requests that need an owner',
            },
            {
              href: '/app/tickets?sla=breached',
              title: 'Overdue tickets',
              description: 'Review requests past their SLA',
            },
            {
              href: '/app/chat?view=unassigned',
              title: 'Incoming chats',
              description: 'Pick up a new conversation',
            },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="overview-queue">
              <span className="overview-queue-copy">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <span className="overview-queue-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}

async function OverviewMetrics({ organizationId }: { organizationId: string }) {
  const report = await getReport(organizationId);
  return report ? <TodayMetrics report={report} /> : <ReportUnavailable />;
}
