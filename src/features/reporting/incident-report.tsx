import Link from 'next/link';

import { RetryButton } from '@/components/ui/retry-button';
import { incidentSeverities } from '@/features/tickets/incidents';
import { Timestamp } from '@/features/timezones/provider';
import { createClient } from '@/lib/supabase/server';

import { duration } from './model';

export type IncidentReportData = {
  asOf: string;
  summary: {
    total: number;
    open: number;
    announcementMinutes: number | null;
    announcementSamples: number;
    resolutionMinutes: number | null;
    resolutionSamples: number;
    downtimeMinutes: number | null;
    downtimeSamples: number;
  };
  breakdowns: { kind: string; label: string; value: number }[];
  items: {
    id: string;
    number: number;
    title: string;
    severity: keyof typeof incidentSeverities;
    status: string;
    impact: string;
    services: string[];
    locations: string[];
    createdAt: string;
    ticketMinutes: number;
    downtimeMinutes: number | null;
    startedAt: string | null;
    restoredAt: string | null;
  }[];
};
export async function IncidentReport({
  organizationId,
  page = 1,
}: {
  organizationId: string;
  page?: number;
}) {
  const db = await createClient();
  const { data, error } = await db.rpc('incident_report', { org: organizationId, page });
  if (error || !data || typeof data !== 'object' || !('summary' in data))
    return (
      <section className="settings-card" aria-label="Incidents">
        <p role="alert">
          Incident reporting could not load. <RetryButton />
        </p>
      </section>
    );
  const report = data as unknown as IncidentReportData,
    s = report.summary,
    more = report.items.length > 20;
  const metrics = [
    ['Incidents', s.total, 'Declared in the last 30 days'],
    ['Open now', s.open, 'Includes older incidents'],
    [
      'Avg. first announcement',
      duration(s.announcementMinutes),
      `${s.announcementSamples} published · from declaration`,
    ],
    [
      'Avg. ticket resolution',
      duration(s.resolutionMinutes),
      `${s.resolutionSamples} resolved · from ticket creation`,
    ],
    [
      'Avg. service downtime',
      duration(s.downtimeMinutes),
      `${s.downtimeSamples} with both service times recorded`,
    ],
  ];
  return (
    <section
      id="incident-report"
      className="settings-card incident-report"
      aria-labelledby="incident-report-heading"
    >
      <div className="section-heading-row">
        <div>
          <h2 id="incident-report-heading">Incidents</h2>
          <p className="muted">Last 30 days, plus all open incidents</p>
        </div>
      </div>
      <dl className="incident-report-metrics">
        {metrics.map(([label, value, hint]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <small className="muted">{hint}</small>
          </div>
        ))}
      </dl>
      <details>
        <summary>By service, location &amp; severity</summary>
        <div className="incident-report-breakdowns">
          {[
            ['severity', 'Severity'],
            ['service', 'Service'],
            ['location', 'Location'],
          ].map(([kind, label]) => (
            <div key={kind}>
              <h3>{label}</h3>
              {!report.breakdowns.some((r) => r.kind === kind) && (
                <p className="muted">No incidents in this period.</p>
              )}
              <ul>
                {report.breakdowns
                  .filter((r) => r.kind === kind)
                  .map((r) => (
                    <li key={r.label}>
                      <span>
                        {kind === 'severity'
                          ? (incidentSeverities[r.label as keyof typeof incidentSeverities]
                              ?.label ?? r.label)
                          : r.label}
                      </span>
                      <strong>{r.value}</strong>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <details open={page > 1}>
        <summary>Incident details</summary>
        {!report.items.length && <p className="muted">No incidents to show.</p>}
        <ul className="incident-report-list">
          {report.items.slice(0, 20).map((item) => (
            <li key={item.id}>
              <div className="section-heading-row">
                <Link href={`/app/tickets/${item.id}#incident-summary`}>
                  #{item.number} · {item.title}
                </Link>
                <span className={`ticket-badge tone-${incidentSeverities[item.severity].tone}`}>
                  {incidentSeverities[item.severity].label}
                </span>
              </div>
              <p className="muted">
                {item.status.replaceAll('_', ' ')} · Declared <Timestamp value={item.createdAt} />
              </p>
              <p>{item.impact}</p>
              <p className="muted">
                {item.services.join(', ') || 'Service not recorded'} ·{' '}
                {item.locations.join(', ') || 'Location not recorded'}
              </p>
              <p>
                {['resolved', 'closed'].includes(item.status)
                  ? `Ticket resolution: ${duration(item.ticketMinutes)}`
                  : `Open for ${duration(item.ticketMinutes)}`}{' '}
                · Service downtime: {duration(item.downtimeMinutes)}
              </p>
              {item.startedAt && (
                <p className="muted">
                  Disruption <Timestamp value={item.startedAt} />
                  {item.restoredAt && (
                    <>
                      {' '}
                      · Restored <Timestamp value={item.restoredAt} />
                    </>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
        {(page > 1 || more) && (
          <nav className="service-notices-pagination" aria-label="Incident report pages">
            {page > 1 && (
              <Link href={`/app/reports?incidentPage=${page - 1}#incident-report`}>Previous</Link>
            )}
            <span>Page {page}</span>
            {more && (
              <Link href={`/app/reports?incidentPage=${page + 1}#incident-report`}>Next</Link>
            )}
          </nav>
        )}
      </details>
    </section>
  );
}
