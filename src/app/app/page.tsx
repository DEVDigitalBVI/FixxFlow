import Link from 'next/link';
import { cache, Suspense } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { PageHeader } from '@/components/ui/page-header';
import { QueueShortcuts, WorkQueues } from '@/features/dashboard/work-queues';
import { EmployeeHome } from '@/features/portal/employee-home';
import { ServiceAnnouncements } from '@/features/portal/service-announcements';
import { ReportUnavailable, TodayMetrics } from '@/features/reporting/components';
import { DashboardInsights, getDashboardWorkload } from '@/features/reporting/dashboard-insights';
import { getReport } from '@/features/reporting/data';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

const getDashboardReport = cache((organizationId: string) => getReport(organizationId));

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
        announcements={<ServiceAnnouncements />}
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
      <ServiceAnnouncements />
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
            View reports &amp; trends{' '}
            <span aria-hidden="true">
              <NavigationIcon name="arrowUpRight" className="inline-icon" size={16} />
            </span>
          </Link>
        </div>
        <Suspense
          fallback={
            <QueueShortcuts
              loading
              counts={{ mine: null, unassigned: null, overdue: null, chats: null }}
            />
          }
        >
          <WorkQueues viewer={viewer} />
        </Suspense>
      </section>
      <Suspense fallback={<p role="status">Loading workload and response trends…</p>}>
        <OverviewInsights organizationId={viewer.organizationId} />
      </Suspense>
    </div>
  );
}

async function OverviewMetrics({ organizationId }: { organizationId: string }) {
  const report = await getDashboardReport(organizationId);
  return report ? <TodayMetrics report={report} /> : <ReportUnavailable />;
}

async function OverviewInsights({ organizationId }: { organizationId: string }) {
  const [report, workload] = await Promise.all([
    getDashboardReport(organizationId),
    getDashboardWorkload(organizationId),
  ]);
  return <DashboardInsights report={report} workload={workload} />;
}
