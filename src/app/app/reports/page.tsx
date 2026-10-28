import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import {
  ReportCharts,
  ReportUnavailable,
  ServiceLevels,
  TodayMetrics,
} from '@/features/reporting/components';
import { SavedReportList } from '@/features/reporting/custom-components';
import { getSavedReports } from '@/features/reporting/custom-data';
import { getReport } from '@/features/reporting/data';
import { IncidentReport } from '@/features/reporting/incident-report';
import { ReportDownload } from '@/features/reporting/report-download';
import { SatisfactionReport } from '@/features/reporting/satisfaction-report';
import { requireViewer } from '@/lib/auth/viewer';
import { reportServerError } from '@/lib/server-errors';

const reportSections = [
  ['tickets-today', 'At a glance'],
  ['report-sla-title', 'Service levels'],
  ['report-trends-title', 'Activity & turnaround'],
  ['report-workload-title', 'Current workload'],
  ['report-breakdowns-title', 'Where requests come from'],
];
const supportingSections = [
  ['report-satisfaction', 'Satisfaction'],
  ['incident-report', 'Incidents'],
  ['saved-reports', 'Saved reports'],
];

async function loadSavedReports(organizationId: string) {
  try {
    return await getSavedReports(organizationId);
  } catch (error) {
    reportServerError('report.saved.load', error);
    return null;
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ incidentPage?: string }>;
}) {
  const params = await searchParams;
  const incidentPage = Math.min(100000, Math.max(1, Number(params.incidentPage) || 1));
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const [report, savedReports] = await Promise.all([
    getReport(viewer.organizationId),
    loadSavedReports(viewer.organizationId),
  ]);
  return (
    <div className="page reports-page">
      <PageHeader
        title="Reports"
        eyebrow={viewer.organizationName}
        description="Understand your workload, service levels and support trends."
        actions={
          <Link className="button button-secondary" href="/app/tickets">
            Open ticket queue
          </Link>
        }
      />
      <nav className="report-jump-nav" aria-label="Report sections">
        {[...(report ? reportSections : []), ...supportingSections].map(([id, label]) => (
          <a key={id} className="button button-quiet" href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      {report ? (
        <>
          <section className="settings-card report-toolbar" aria-labelledby="report-period-title">
            <div>
              <h2 id="report-period-title">Last 30 days</h2>
              <p>Includes today · {report.timezone}</p>
              <span className="muted">Current workload is shown separately.</span>
            </div>
            <ReportDownload />
          </section>
          <TodayMetrics report={report} title="At a glance" />
          <ServiceLevels report={report} canViewTargets={viewer.role === 'administrator'} />
          <ReportCharts report={report} />
        </>
      ) : (
        <ReportUnavailable />
      )}
      <SatisfactionReport organizationId={viewer.organizationId} />
      <IncidentReport organizationId={viewer.organizationId} page={Math.floor(incidentPage)} />
      <SavedReportList reports={savedReports} viewerId={viewer.id} />
    </div>
  );
}
