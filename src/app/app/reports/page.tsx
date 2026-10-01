import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { getReport } from '@/features/reporting/data';
import { ReportCharts, ReportUnavailable, ServiceLevels, TodayMetrics } from '@/features/reporting/components';
import { ReportDownload } from '@/features/reporting/report-download';

export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const report = await getReport(viewer.organizationId);
  return <div className="page reports-page">
    <PageHeader title="Reports" eyebrow={viewer.organizationName} description="Understand your workload, service levels and support trends." actions={<Link className="button button-secondary" href="/app/tickets">Open ticket queue</Link>}/>
    {report ? <>
      <section className="settings-card report-toolbar" aria-labelledby="report-period-title">
        <div><h2 id="report-period-title">Last 30 days</h2><p>Includes today · British Virgin Islands time</p><span className="muted">Current workload is shown separately.</span></div>
        <ReportDownload/>
      </section>
      <TodayMetrics report={report} title="At a glance"/>
      <ServiceLevels report={report} canViewTargets={viewer.role === 'administrator'}/>
      <ReportCharts report={report}/>
    </> : <ReportUnavailable/>}
  </div>;
}
