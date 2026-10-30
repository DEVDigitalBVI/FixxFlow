import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { RetryButton } from '@/components/ui/retry-button';
import { Table, TableRegion } from '@/components/ui/table';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

import { Trend } from './components';
import type { Report } from './model';

export type WorkloadRow = {
  user_id: string | null;
  label: string;
  active: boolean;
  open_count: number;
  waiting_count: number;
  overdue_count: number;
};
export async function getDashboardWorkload(organizationId: string): Promise<WorkloadRow[] | null> {
  try {
    const db = await createClient();
    const { data, error } = await db
      .rpc('technician_workload', { org: organizationId })
      .order('open_count', { ascending: false })
      .order('label')
      .order('user_id', { nullsFirst: false })
      .range(0, 4);
    if (error) throw error;
    return data;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('report.workload.load', error);
    return null;
  }
}
export function WorkloadCard({ rows }: { rows: WorkloadRow[] | null }) {
  return (
    <section className="settings-card report-chart" aria-labelledby="dashboard-workload-title">
      <h3 id="dashboard-workload-title">Technician workload</h3>
      <p>Top 5 by open tickets. Waiting and overdue are included in Open.</p>
      {rows === null ? (
        <div role="alert">
          <p>Workload couldn’t load.</p>
          <RetryButton />
        </div>
      ) : rows.every((row) => row.open_count === 0) ? (
        <p>No open tickets right now.</p>
      ) : (
        <TableRegion role="region" aria-label="Current technician workload" tabIndex={0}>
          <Table className="table-policy">
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Open</th>
                <th scope="col">Waiting</th>
                <th scope="col">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id ?? 'unassigned'}>
                  <td data-label="Owner">
                    <strong>{row.label}</strong>
                    {!row.active && <span className="muted"> · No longer active in IT</span>}
                  </td>
                  <td data-label="Open">{row.open_count}</td>
                  <td data-label="Waiting">{row.waiting_count}</td>
                  <td data-label="Overdue">{row.overdue_count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableRegion>
      )}
    </section>
  );
}
export function DashboardInsights({
  report,
  workload,
}: {
  report: Report | null;
  workload: WorkloadRow[] | null;
}) {
  const days = report?.daily.slice(-14) ?? [];
  return (
    <section className="report-section" aria-labelledby="dashboard-insights-title">
      <header className="overview-section-heading">
        <div>
          <h2 id="dashboard-insights-title">Workload &amp; response</h2>
          <p>Current assignments and the last 14 days · {report?.timezone ?? 'Workspace time'}</p>
        </div>
        <Link className={buttonVariants({ variant: 'secondary' })} href="/app/reports">
          View reports
        </Link>
      </header>
      <div className="report-chart-grid">
        <WorkloadCard rows={workload} />
        {report ? (
          <Trend
            title="Response time"
            description="Average elapsed time to the first public IT reply, by reply day. Days without replies have no timing sample."
            days={days.map((day) => day.day)}
            series={[{ label: 'Average response', values: days.map((day) => day.response) }]}
            time
          />
        ) : (
          <section
            className="settings-card report-chart"
            aria-labelledby="dashboard-response-title"
          >
            <h3 id="dashboard-response-title">Response time</h3>
            <p role="alert">The response trend couldn’t load.</p>
            <RetryButton />
          </section>
        )}
      </div>
    </section>
  );
}
