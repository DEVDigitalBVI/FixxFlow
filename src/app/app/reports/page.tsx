import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { getReport } from '@/features/reporting/data';
import { ReportCharts, ReportUnavailable, TodayMetrics } from '@/features/reporting/components';
import { ReportDownload } from '@/features/reporting/report-download';

export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const report = await getReport(viewer.organizationId);
  return <div className="page"><PageHeader title="Reports" eyebrow={viewer.organizationName} description="Daily operations and the last 30 days of support activity." actions={<Link className="button button-secondary" href="/app/tickets">Open ticket queue</Link>}/>{report ? <><ReportDownload/><TodayMetrics report={report}/><section className="report-period"><h2>Last 30 days</h2><p>Includes today. All times use calendar hours, including evenings and weekends. Workload and backlog show the current position.</p></section><ReportCharts report={report}/></> : <ReportUnavailable/>}</div>;
}
