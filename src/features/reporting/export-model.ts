import type { Report } from './model';

export const exportFormats = {
  xlsx: {
    label: 'Excel (.xlsx)',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { label: 'CSV (.csv)', mime: 'text/csv' },
  pdf: { label: 'PDF (.pdf)', mime: 'application/pdf' },
} as const;
export type ExportFormat = keyof typeof exportFormats;
export function isExportFormat(value: string | null): value is ExportFormat {
  return value !== null && Object.hasOwn(exportFormats, value);
}
export function exportFilename(report: Pick<Report, 'today'>, format: ExportFormat) {
  return `fixxflow-report-${report.today.replace(/[^0-9-]/g, '')}.${format}`;
}
export function reportPeriod(report: Report) {
  const days = report.daily.map((row) => row.day).sort();
  return { start: days[0] ?? report.today, end: days.at(-1) ?? report.today };
}
export const breakdownDefinitions: Record<string, { title: string; note: string }> = {
  categories: {
    title: 'Ticket categories',
    note: 'Tickets created in the reporting period, by current category.',
  },
  workload: {
    title: 'Technician workload',
    note: 'Currently open tickets, including unassigned work.',
  },
  backlog: {
    title: 'Backlog age',
    note: 'Age since creation of all currently open tickets, including those waiting on a reply.',
  },
  departments: {
    title: 'Tickets by department',
    note: 'Tickets created in the reporting period, by the requester’s current department.',
  },
  locations: {
    title: 'Tickets by location',
    note: 'Tickets created in the reporting period, by the location saved on each ticket.',
  },
};
export const dailyDefinitions = [
  { key: 'created', label: 'Created', unit: 'tickets', note: 'Tickets created that day.' },
  {
    key: 'resolved',
    label: 'Resolved',
    unit: 'tickets',
    note: 'Tickets resolved that day, including any since reopened.',
  },
  {
    key: 'reopened',
    label: 'Reopened',
    unit: 'tickets',
    note: 'Distinct tickets moved from resolved or closed to an active status that day.',
  },
  {
    key: 'response',
    label: 'Average response',
    unit: 'minutes',
    note: 'Creation to response or self-assigned technician acknowledgment, grouped by recorded day.',
  },
  {
    key: 'resolution',
    label: 'Average resolution',
    unit: 'minutes',
    note: 'Creation to latest resolution, grouped by resolution day. Reopened tickets excluded until resolved again.',
  },
] as const;
export const slaNote =
  'Completed targets in the reporting period. Support-hour deadlines exclude waiting and documented holds; pre-hold breaches remain. A technician starting their own request counts as response acknowledgment. Pending targets and missing deadlines are excluded.';
export const timingNote =
  'All durations are elapsed calendar minutes, including evenings and weekends. No data means no completed timing samples.';
export function summaryRows(report: Report) {
  const s = report.summary;
  return [
    {
      label: 'Created',
      value: s.created,
      unit: 'tickets',
      scope: report.today,
      note: 'Tickets opened today.',
    },
    {
      label: 'Resolved',
      value: s.resolved,
      unit: 'tickets',
      scope: report.today,
      note: 'Tickets resolved today, including any since reopened.',
    },
    {
      label: 'Open',
      value: s.open,
      unit: 'tickets',
      scope: 'Current snapshot',
      note: 'All unresolved tickets right now.',
    },
    {
      label: 'Overdue',
      value: s.overdue,
      unit: 'tickets',
      scope: 'Current snapshot',
      note: 'Open tickets with a breached response or resolution SLA.',
    },
    {
      label: 'Average response',
      value: s.response,
      unit: 'minutes',
      scope: report.today,
      note: 'First public IT replies or self-assigned technician acknowledgments recorded today.',
    },
    {
      label: 'Average resolution',
      value: s.resolution,
      unit: 'minutes',
      scope: report.today,
      note: 'Latest resolutions recorded today.',
    },
    ...(report.lifecycle
      ? [
          {
            label: 'Average acknowledgment',
            value: report.lifecycle.acknowledgment,
            unit: 'minutes',
            scope: 'Last 30 days',
            note: `Work started or first public reply; ${report.lifecycle.acknowledgmentSamples} recorded samples. Historical acknowledgments are not reconstructed.`,
          },
          {
            label: 'On hold',
            value: report.lifecycle.heldTickets,
            unit: 'tickets',
            scope: 'Current snapshot',
            note: 'Tickets currently on hold.',
          },
          {
            label: 'Hold follow-ups overdue',
            value: report.lifecycle.holdReviewsDue,
            unit: 'tickets',
            scope: 'Current snapshot',
            note: 'Includes legacy holds missing a follow-up date.',
          },
          {
            label: 'Average resolution support time',
            value: report.lifecycle.resolutionSupport,
            unit: 'minutes',
            scope: 'Last 30 days',
            note: `Support time excluding pauses; ${report.lifecycle.resolutionSupportSamples} completed samples.`,
          },
          {
            label: 'Average total turnaround',
            value: report.lifecycle.resolutionElapsed,
            unit: 'minutes',
            scope: 'Last 30 days',
            note: 'Creation to resolution, including nights, weekends and delays.',
          },
          {
            label: 'Average recorded paused time',
            value: report.lifecycle.holdElapsed,
            unit: 'minutes',
            scope: 'Last 30 days',
            note: 'Elapsed waiting and hold time recorded since this workflow was introduced; historical pauses are not reconstructed.',
          },
        ]
      : []),
  ];
}
