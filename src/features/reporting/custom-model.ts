import { isUuid } from '@/lib/ids';
import { isObjectRecord as record } from '@/lib/validation';
import type { Json, TicketPriority, TicketStatus } from '@/types/database';

export const reportTypes = {
  volume: { label: 'Ticket volume', description: 'Created, resolved and reopened tickets.' },
  turnaround: {
    label: 'Response and resolution time',
    description: 'Elapsed time for completed responses and resolutions.',
  },
  sla: {
    label: 'SLA performance',
    description: 'Completed response and resolution targets met on time.',
  },
  backlog: { label: 'Current backlog', description: 'Open and overdue work right now.' },
} as const;
export type CustomReportType = keyof typeof reportTypes;

export const reportMetrics = {
  created: { label: 'Created', unit: 'tickets', type: 'volume' },
  resolved: { label: 'Resolved', unit: 'tickets', type: 'volume' },
  reopened: { label: 'Reopened', unit: 'tickets', type: 'volume' },
  response_time: { label: 'Average response', unit: 'minutes', type: 'turnaround' },
  resolution_time: { label: 'Average resolution', unit: 'minutes', type: 'turnaround' },
  response_sla: { label: 'Response SLA', unit: 'percent', type: 'sla' },
  resolution_sla: { label: 'Resolution SLA', unit: 'percent', type: 'sla' },
  open: { label: 'Open', unit: 'tickets', type: 'backlog' },
  overdue: { label: 'Overdue', unit: 'tickets', type: 'backlog' },
} as const;
export type CustomReportMetric = keyof typeof reportMetrics;
export type ReportInterval = 'day' | 'week' | 'month';
export type ReportGroup =
  | 'time'
  | 'status'
  | 'priority'
  | 'category'
  | 'subcategory'
  | 'team'
  | 'technician'
  | 'department'
  | 'location';
export type ReportFilters = {
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  categoryIds: string[];
  subcategoryIds: string[];
  teamIds: string[];
  technicianIds: string[];
  departmentIds: string[];
  locationIds: string[];
};
export type CustomReportDefinition = {
  reportType: CustomReportType;
  startDate: string;
  endDate: string;
  interval: ReportInterval;
  groupBy: ReportGroup;
  metrics: CustomReportMetric[];
  filters: ReportFilters;
};
export type CustomReport = {
  asOf: string;
  timezone: string;
  startDate: string;
  endDate: string;
  reportType: CustomReportType;
  groupBy: ReportGroup;
  interval: ReportInterval;
  metrics: {
    key: CustomReportMetric;
    label: string;
    unit: 'tickets' | 'minutes' | 'percent';
    description: string;
  }[];
  summary: {
    key: CustomReportMetric;
    label: string;
    unit: 'tickets' | 'minutes' | 'percent';
    value: number | null;
    samples: number;
  }[];
  rows: {
    key: string;
    label: string;
    values: Partial<Record<CustomReportMetric, number | null>>;
    samples: Partial<Record<CustomReportMetric, number>>;
  }[];
};
export type SavedReport = {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  visibility: 'personal' | 'shared';
  definition: CustomReportDefinition;
  created_at: string;
  updated_at: string;
};
export type ReportSchedule = {
  id: string;
  report_id: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  monthday: number | null;
  run_hour: number;
  timezone: string;
  format: 'xlsx' | 'csv' | 'pdf';
  recipient_emails: string[];
  active: boolean;
  next_run_at: string;
  last_enqueued_at: string | null;
};
export type ReportDelivery = {
  id: string;
  recipient_email: string;
  format: string;
  status: 'pending' | 'leased' | 'sent' | 'failed';
  attempts: number;
  scheduled_for: string;
  snapshot_at: string | null;
  completed_at: string | null;
  error_code: string | null;
};
export type ReportReferences = {
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string; category_id: string }[];
  teams: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
};

const typeMetrics: Record<CustomReportType, CustomReportMetric[]> = {
  volume: ['created', 'resolved', 'reopened'],
  turnaround: ['response_time', 'resolution_time'],
  sla: ['response_sla', 'resolution_sla'],
  backlog: ['open', 'overdue'],
};
export const groupLabels: Record<ReportGroup, string> = {
  time: 'Time',
  status: 'Status',
  priority: 'Priority',
  category: 'Category',
  subcategory: 'Subcategory',
  team: 'Team',
  technician: 'Technician',
  department: 'Requester department',
  location: 'Ticket location',
};
export const intervalLabels: Record<ReportInterval, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};
export const emptyFilters = (): ReportFilters => ({
  statuses: [],
  priorities: [],
  categoryIds: [],
  subcategoryIds: [],
  teamIds: [],
  technicianIds: [],
  departmentIds: [],
  locationIds: [],
});
export function defaultReportDefinition(
  today: string,
  reportType: CustomReportType = 'volume',
): CustomReportDefinition {
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    reportType,
    startDate: start.toISOString().slice(0, 10),
    endDate: today,
    interval: 'day',
    groupBy: reportType === 'backlog' ? 'technician' : 'time',
    metrics: [...typeMetrics[reportType]],
    filters: emptyFilters(),
  };
}
export function dateInTimezone(timeZone: string, value = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const stringArray = (value: unknown, predicate: (item: unknown) => boolean) =>
  Array.isArray(value) && value.length <= 20 && value.every(predicate);
const statuses = new Set<TicketStatus>([
  'new',
  'open',
  'in_progress',
  'waiting_on_user',
  'on_hold',
  'resolved',
  'closed',
]);
const priorities = new Set<TicketPriority>(['low', 'normal', 'high', 'critical']);
const groups = new Set<ReportGroup>(Object.keys(groupLabels) as ReportGroup[]);
const intervals = new Set<ReportInterval>(['day', 'week', 'month']);
export function isCustomReportDefinition(value: unknown): value is CustomReportDefinition {
  if (
    !record(value) ||
    typeof value.reportType !== 'string' ||
    !Object.hasOwn(reportTypes, value.reportType) ||
    !isDate(value.startDate) ||
    !isDate(value.endDate) ||
    !intervals.has(value.interval as ReportInterval) ||
    !groups.has(value.groupBy as ReportGroup)
  )
    return false;
  const reportType = value.reportType as CustomReportType;
  const start = Date.parse(`${value.startDate}T00:00:00Z`),
    end = Date.parse(`${value.endDate}T00:00:00Z`);
  if (
    end < start ||
    (end - start) / 86400000 > 365 ||
    (reportType === 'backlog' && value.groupBy === 'time')
  )
    return false;
  if (
    !Array.isArray(value.metrics) ||
    value.metrics.length < 1 ||
    value.metrics.length > 3 ||
    new Set(value.metrics).size !== value.metrics.length ||
    !value.metrics.every(
      (metric) =>
        typeof metric === 'string' &&
        typeMetrics[reportType].includes(metric as CustomReportMetric),
    )
  )
    return false;
  if (!record(value.filters)) return false;
  const filters = value.filters;
  return (
    stringArray(
      filters.statuses,
      (item) => typeof item === 'string' && statuses.has(item as TicketStatus),
    ) &&
    stringArray(
      filters.priorities,
      (item) => typeof item === 'string' && priorities.has(item as TicketPriority),
    ) &&
    [
      'categoryIds',
      'subcategoryIds',
      'teamIds',
      'technicianIds',
      'departmentIds',
      'locationIds',
    ].every((key) => stringArray(filters[key], isUuid))
  );
}
export function isCustomReport(value: unknown): value is CustomReport {
  if (
    !record(value) ||
    typeof value.asOf !== 'string' ||
    typeof value.timezone !== 'string' ||
    !isDate(value.startDate) ||
    !isDate(value.endDate) ||
    typeof value.reportType !== 'string' ||
    !Object.hasOwn(reportTypes, value.reportType) ||
    !groups.has(value.groupBy as ReportGroup) ||
    !intervals.has(value.interval as ReportInterval) ||
    !Array.isArray(value.metrics) ||
    !Array.isArray(value.summary) ||
    !Array.isArray(value.rows)
  )
    return false;
  const metricKeys = new Set<CustomReportMetric>();
  for (const metric of value.metrics) {
    if (
      !record(metric) ||
      typeof metric.key !== 'string' ||
      !Object.hasOwn(reportMetrics, metric.key) ||
      typeof metric.label !== 'string' ||
      !['tickets', 'minutes', 'percent'].includes(String(metric.unit)) ||
      typeof metric.description !== 'string'
    )
      return false;
    metricKeys.add(metric.key as CustomReportMetric);
  }
  return (
    value.summary.every(
      (row) =>
        record(row) &&
        metricKeys.has(row.key as CustomReportMetric) &&
        typeof row.label === 'string' &&
        (row.value === null || typeof row.value === 'number') &&
        typeof row.samples === 'number',
    ) &&
    value.rows.every(
      (row) =>
        record(row) &&
        typeof row.key === 'string' &&
        typeof row.label === 'string' &&
        record(row.values) &&
        record(row.samples) &&
        Object.entries(row.values).every(
          ([key, item]) =>
            metricKeys.has(key as CustomReportMetric) &&
            (item === null || typeof item === 'number'),
        ) &&
        Object.entries(row.samples).every(
          ([key, item]) => metricKeys.has(key as CustomReportMetric) && typeof item === 'number',
        ),
    )
  );
}
const values = (data: FormData | URLSearchParams, key: string) =>
  data.getAll(key).filter((value): value is string => typeof value === 'string' && value !== '');
export function definitionFromInput(
  data: FormData | URLSearchParams,
  fallback: CustomReportDefinition,
): CustomReportDefinition | null {
  const reportType = String(data.get('reportType') ?? fallback.reportType) as CustomReportType;
  const definition: CustomReportDefinition = {
    reportType,
    startDate: String(data.get('startDate') ?? fallback.startDate),
    endDate: String(data.get('endDate') ?? fallback.endDate),
    interval: String(data.get('interval') ?? fallback.interval) as ReportInterval,
    groupBy: String(data.get('groupBy') ?? fallback.groupBy) as ReportGroup,
    metrics: values(data, 'metrics') as CustomReportMetric[],
    filters: {
      statuses: values(data, 'statuses') as TicketStatus[],
      priorities: values(data, 'priorities') as TicketPriority[],
      categoryIds: values(data, 'categoryIds'),
      subcategoryIds: values(data, 'subcategoryIds'),
      teamIds: values(data, 'teamIds'),
      technicianIds: values(data, 'technicianIds'),
      departmentIds: values(data, 'departmentIds'),
      locationIds: values(data, 'locationIds'),
    },
  };
  return isCustomReportDefinition(definition) ? definition : null;
}
export function definitionToQuery(definition: CustomReportDefinition) {
  const query = new URLSearchParams({
    reportType: definition.reportType,
    startDate: definition.startDate,
    endDate: definition.endDate,
    interval: definition.interval,
    groupBy: definition.groupBy,
  });
  for (const metric of definition.metrics) query.append('metrics', metric);
  for (const [key, items] of Object.entries(definition.filters))
    for (const item of items) query.append(key, item);
  return query;
}
export function definitionAsJson(definition: CustomReportDefinition): Json {
  return definition as unknown as Json;
}
export function formatCustomValue(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return 'No data';
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  if (unit === 'minutes')
    return value < 1 ? '<1m' : value < 60 ? `${Math.round(value)}m` : `${(value / 60).toFixed(1)}h`;
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value);
}
export const reportTemplates: {
  name: string;
  description: string;
  type: CustomReportType;
  groupBy: ReportGroup;
  metrics: CustomReportMetric[];
}[] = [
  {
    name: 'Demand trend',
    description: 'Created, resolved and reopened tickets over time.',
    type: 'volume',
    groupBy: 'time',
    metrics: ['created', 'resolved', 'reopened'],
  },
  {
    name: 'Service turnaround',
    description: 'Average response and resolution time.',
    type: 'turnaround',
    groupBy: 'time',
    metrics: ['response_time', 'resolution_time'],
  },
  {
    name: 'SLA performance',
    description: 'Response and resolution targets met on time.',
    type: 'sla',
    groupBy: 'time',
    metrics: ['response_sla', 'resolution_sla'],
  },
  {
    name: 'Team workload',
    description: 'Open and overdue tickets by technician.',
    type: 'backlog',
    groupBy: 'technician',
    metrics: ['open', 'overdue'],
  },
  {
    name: 'Category demand',
    description: 'Ticket volume by current category.',
    type: 'volume',
    groupBy: 'category',
    metrics: ['created', 'resolved'],
  },
];
