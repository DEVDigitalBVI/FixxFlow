import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { getReport } from '@/features/reporting/data';
import { ReportCharts, ReportUnavailable, TodayMetrics } from '@/features/reporting/components';

export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const report = await getReport(viewer.organizationId);
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">{viewer.organizationName}</span><h1>Reports</h1><p>Daily operations and the last 30 days of support activity.</p></div><Link className="button button-secondary" href="/app/tickets">Open ticket queue</Link></header>{report ? <><TodayMetrics report={report}/><section className="report-period"><h2>Last 30 days</h2><p>Includes today. All times use calendar hours, including evenings and weekends. Workload and backlog show the current position.</p></section><ReportCharts report={report}/></> : <ReportUnavailable/>}</div>;
}
