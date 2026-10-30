import Link from 'next/link';

import {
  deleteReport,
  manageReportSchedule,
  saveReport,
  saveReportSchedule,
} from '@/app/app/reports/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { Table, TableRegion } from '@/components/ui/table';

import { Bars, Trend } from './components';
import { CustomReportDownload } from './custom-download';
import {
  definitionToQuery,
  formatCustomValue,
  groupLabels,
  reportTypes,
  type CustomReport,
  type CustomReportDefinition,
  type ReportDelivery,
  type ReportSchedule,
  type SavedReport,
} from './custom-model';
import { ScheduleTimingFields } from './schedule-fields';

export function DefinitionFields({ definition }: { definition: CustomReportDefinition }) {
  return (
    <>
      {[...definitionToQuery(definition)].map(([name, value], index) => (
        <input type="hidden" name={name} value={value} key={`${name}-${value}-${index}`} />
      ))}
    </>
  );
}
export function CustomReportResults({ report }: { report: CustomReport }) {
  const time = report.groupBy === 'time';
  return (
    <section className="custom-report-results" aria-labelledby="custom-report-results-title">
      <header className="tech-section-heading">
        <div>
          <h2 id="custom-report-results-title">Report results</h2>
          <p>
            {reportTypes[report.reportType].label} ·{' '}
            {report.reportType === 'backlog'
              ? 'Current snapshot'
              : `${report.startDate} to ${report.endDate}`}{' '}
            · {report.timezone}
          </p>
        </div>
        <span className="muted">
          Updated{' '}
          {new Intl.DateTimeFormat('en', {
            timeZone: report.timezone,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(report.asOf))}
        </span>
      </header>
      <dl className="report-metrics custom-report-summary">
        {report.summary.map((item) => (
          <div className="settings-card" key={item.key}>
            <dt>{item.label}</dt>
            <dd>
              <span>{formatCustomValue(item.value, item.unit)}</span>
              <p>
                {item.samples
                  ? `${item.samples} ticket${item.samples === 1 ? '' : 's'} measured`
                  : item.unit === 'tickets'
                    ? 'No matching tickets'
                    : 'No completed samples'}
              </p>
            </dd>
          </div>
        ))}
      </dl>
      {report.rows.length ? (
        <div className="report-chart-grid">
          {time ? (
            <Trend
              title={`${reportTypes[report.reportType].label} trend`}
              description={`${report.startDate} to ${report.endDate}, grouped by ${report.interval}.`}
              days={report.rows.map((row) => row.label)}
              series={report.metrics.map((metric) => ({
                label: metric.label,
                values: report.rows.map((row) => row.values[metric.key] ?? null),
              }))}
              time={report.metrics[0]?.unit === 'minutes'}
            />
          ) : (
            report.metrics.map((metric) => (
              <Bars
                key={metric.key}
                title={`${metric.label} by ${groupLabels[report.groupBy].toLowerCase()}`}
                description={metric.description}
                rows={report.rows.map((row) => ({
                  label: row.label,
                  value: row.values[metric.key] ?? 0,
                  detail:
                    metric.unit === 'minutes' || metric.unit === 'percent'
                      ? `${row.samples[metric.key] ?? 0} completed sample${(row.samples[metric.key] ?? 0) === 1 ? '' : 's'}`
                      : undefined,
                }))}
                percent={metric.unit === 'percent'}
                allRows
              />
            ))
          )}
        </div>
      ) : (
        <EmptyState>
          <strong>No matching report data</strong>
          <p>Change the period or remove one or more filters.</p>
        </EmptyState>
      )}
      {!time && report.reportType !== 'backlog' && (
        <p className="report-footnote">
          Activity is dated by the event or completion time. Category, assignment and location
          groups use each ticket’s current values.
        </p>
      )}
      <details className="settings-card custom-report-table">
        <summary>
          View exact report data · {report.rows.length} row{report.rows.length === 1 ? '' : 's'}
        </summary>
        <TableRegion
          className="report-data-region"
          role="region"
          aria-label="Custom report exact data"
          tabIndex={0}
        >
          <Table className="responsive-table">
            <caption>
              {reportTypes[report.reportType].label} grouped by{' '}
              {groupLabels[report.groupBy].toLowerCase()}
            </caption>
            <thead>
              <tr>
                <th scope="col">{groupLabels[report.groupBy]}</th>
                {report.metrics.map((metric) => (
                  <th scope="col" key={metric.key}>
                    {metric.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" data-label={groupLabels[report.groupBy]}>
                    {row.label}
                  </th>
                  {report.metrics.map((metric) => (
                    <td data-label={metric.label} key={metric.key}>
                      {formatCustomValue(row.values[metric.key] ?? null, metric.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableRegion>
      </details>
    </section>
  );
}
export function SaveReportPanel({
  definition,
  savedReport,
  role,
  canEdit = true,
}: {
  definition: CustomReportDefinition;
  savedReport?: SavedReport | null;
  role: 'administrator' | 'technician';
  canEdit?: boolean;
}) {
  if (!canEdit)
    return (
      <Alert tone="info">
        <strong>This is a shared report.</strong>
        <p>
          Run or export it here. Only its owner or an administrator can change the saved definition.
        </p>
      </Alert>
    );
  return (
    <section className="settings-card report-save-panel">
      <div>
        <h2>{savedReport ? 'Save changes' : 'Save this report'}</h2>
        <p className="muted">
          Saved reports keep the definition; results refresh whenever the report is opened or
          delivered.
        </p>
      </div>
      <ActionForm action={saveReport} className="custom-report-save-form">
        <DefinitionFields definition={definition} />
        {savedReport && <input type="hidden" name="reportId" value={savedReport.id} />}
        <label className="field">
          Report name
          <Input
            name="name"
            defaultValue={savedReport?.name ?? ''}
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label className="field">
          Description <span className="muted">Optional</span>
          <Textarea
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={savedReport?.description ?? ''}
          />
        </label>
        {role === 'administrator' && (
          <label className="field">
            Visibility
            <NativeSelect name="visibility" defaultValue={savedReport?.visibility ?? 'personal'}>
              <option value="personal">Personal · only me</option>
              <option value="shared">Shared · all support staff</option>
            </NativeSelect>
          </label>
        )}
        <SubmitButton variant="primary">
          {savedReport ? 'Save changes' : 'Save report'}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}
export function SavedReportList({
  reports,
  viewerId,
}: {
  reports: SavedReport[] | null;
  viewerId: string;
}) {
  return (
    <section id="saved-reports" aria-labelledby="saved-reports-title">
      <header className="overview-section-heading">
        <div>
          <h2 id="saved-reports-title">Saved reports</h2>
          <p>Open a saved report to see current results.</p>
        </div>
        <Link className={buttonVariants({ variant: 'primary' })} href="/app/reports/custom">
          Create custom report
        </Link>
      </header>
      {reports === null ? (
        <Alert tone="warning" role="alert">
          <strong>Saved reports could not load.</strong>
          <p>Your operational report is still available below. Refresh the page to try again.</p>
        </Alert>
      ) : reports.length ? (
        <div className="saved-report-grid">
          {reports.map((report) => (
            <article className="settings-card saved-report-card" key={report.id}>
              <div>
                <Badge>{report.visibility === 'shared' ? 'Shared' : 'Personal'}</Badge>
                <h3>
                  <Link href={`/app/reports/saved/${report.id}`}>{report.name}</Link>
                </h3>
                <p>{report.description || reportTypes[report.definition.reportType].description}</p>
              </div>
              <p className="muted">
                {reportTypes[report.definition.reportType].label} ·{' '}
                {groupLabels[report.definition.groupBy]}
                {report.owner_id === viewerId ? ' · Yours' : ''}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState>
          <strong>No saved reports yet</strong>
          <p>Create a report and save it here for reuse.</p>
        </EmptyState>
      )}
    </section>
  );
}
export function SavedReportActions({ report, canEdit }: { report: SavedReport; canEdit: boolean }) {
  const edit = definitionToQuery(report.definition);
  if (canEdit) edit.set('saved', report.id);
  return (
    <div className="saved-report-actions">
      <Link
        className={buttonVariants({ variant: 'secondary' })}
        href={`/app/reports/custom?${edit}`}
      >
        {canEdit ? 'Edit definition' : 'Customize a copy'}
      </Link>
      {canEdit && (
        <details>
          <summary className={buttonVariants({ variant: 'quiet' })}>Delete report…</summary>
          <ActionForm action={deleteReport} className="stack destructive-report-form">
            <input type="hidden" name="reportId" value={report.id} />
            <p>
              Delete “{report.name}” and all of its delivery schedules? Delivery history will also
              be removed.
            </p>
            <label className="check-field">
              <Checkbox name="confirmation" value={report.id} required />I confirm permanent
              deletion.
            </label>
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Delete report
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function ReportSchedules({
  report,
  schedules,
  deliveries,
  timezone,
  email,
}: {
  report: SavedReport;
  schedules: ReportSchedule[];
  deliveries: ReportDelivery[];
  timezone: string;
  email: string;
}) {
  return (
    <section className="report-schedules" aria-labelledby="report-schedules-title">
      <header className="overview-section-heading">
        <div>
          <h2 id="report-schedules-title">Scheduled delivery</h2>
          <p>Send this report daily, weekly or monthly. New schedules use {timezone}.</p>
        </div>
      </header>
      <div className="report-schedule-layout">
        <ActionForm action={saveReportSchedule} className="settings-card report-schedule-form">
          <input type="hidden" name="reportId" value={report.id} />
          <h3>Add a schedule</h3>
          <div className="report-field-grid">
            <ScheduleTimingFields />
            <label className="field">
              File format
              <NativeSelect name="format" defaultValue="xlsx">
                <option value="xlsx">Excel</option>
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </NativeSelect>
            </label>
          </div>
          <label className="field">
            Recipients
            <Textarea
              name="recipients"
              rows={3}
              defaultValue={email}
              required
              aria-describedby="report-recipient-hint"
            />
          </label>
          <p className="muted" id="report-recipient-hint">
            Separate up to 20 email addresses with commas, spaces or new lines.
          </p>
          <SubmitButton variant="primary">Create schedule</SubmitButton>
        </ActionForm>
        <div>
          {schedules.length ? (
            <ul className="report-schedule-list">
              {schedules.map((schedule) => (
                <li className="settings-card" key={schedule.id}>
                  <div>
                    <strong>
                      {schedule.frequency === 'daily'
                        ? 'Every day'
                        : schedule.frequency === 'weekly'
                          ? `Every ${weekdays[schedule.weekday ?? 1]}`
                          : `Day ${schedule.monthday} of each month`}{' '}
                      at {String(schedule.run_hour).padStart(2, '0')}:00 · {schedule.timezone}
                    </strong>
                    <p>
                      {schedule.format.toUpperCase()} · {schedule.recipient_emails.join(', ')}
                    </p>
                    <p className="muted">
                      {schedule.active
                        ? `Next delivery ${new Intl.DateTimeFormat('en', { timeZone: schedule.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(schedule.next_run_at))}`
                        : 'Paused'}
                    </p>
                  </div>
                  <ActionForm action={manageReportSchedule} className="report-schedule-actions">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="scheduleId" value={schedule.id} />
                    <Button
                      variant="secondary"
                      name="command"
                      value={schedule.active ? 'pause' : 'activate'}
                    >
                      {schedule.active ? 'Pause' : 'Activate'}
                    </Button>
                    <Button variant="quiet" name="command" value="delete">
                      Delete
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>
              <strong>No scheduled delivery</strong>
              <p>Create a daily, weekly or monthly email schedule for this report.</p>
            </EmptyState>
          )}
        </div>
      </div>
      {deliveries.length > 0 && (
        <details className="settings-card report-delivery-history">
          <summary>Delivery history · latest {deliveries.length}</summary>
          <TableRegion role="region" aria-label="Scheduled report delivery history" tabIndex={0}>
            <Table className="responsive-table">
              <thead>
                <tr>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Format</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Scheduled">
                      <time dateTime={item.scheduled_for}>
                        {new Intl.DateTimeFormat('en', {
                          timeZone: timezone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(item.scheduled_for))}
                      </time>
                    </td>
                    <td data-label="Recipient">{item.recipient_email}</td>
                    <td data-label="Format">{item.format.toUpperCase()}</td>
                    <td data-label="Status">{item.status}</td>
                    <td data-label="Attempts">{item.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableRegion>
        </details>
      )}
    </section>
  );
}
export function ReportOutputActions({
  definition,
  name,
}: {
  definition: CustomReportDefinition;
  name?: string;
}) {
  return (
    <div className="report-output-actions">
      <CustomReportDownload definition={definition} name={name} />
    </div>
  );
}
