import { isFiniteNumber as number, isObjectRecord as record } from '@/lib/validation';

/** One row per organization: account metadata and aggregate counts only. */
export type OrganizationExportRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  created_at: string;
  administrators: number;
  technicians: number;
  employees: number;
  inactive_members: number;
  tickets_total: number;
  tickets_open: number;
  tickets_last_30_days: number;
  chats_total: number;
  assets_total: number;
  last_ticket_activity_at: string | null;
};
export type OrganizationExport = {
  generatedAt: string;
  search: string;
  matchingCount: number;
  organizations: OrganizationExportRow[];
};

export const EXPORT_ROW_LIMIT = 5000;

const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const counts = [
  'administrators',
  'technicians',
  'employees',
  'inactive_members',
  'tickets_total',
  'tickets_open',
  'tickets_last_30_days',
  'chats_total',
  'assets_total',
] as const;

export function isOrganizationExport(value: unknown): value is OrganizationExport {
  return (
    record(value) &&
    timestamp(value.generatedAt) &&
    typeof value.search === 'string' &&
    number(value.matchingCount) &&
    Array.isArray(value.organizations) &&
    value.organizations.every(
      (row) =>
        record(row) &&
        typeof row.id === 'string' &&
        typeof row.name === 'string' &&
        typeof row.slug === 'string' &&
        typeof row.timezone === 'string' &&
        timestamp(row.created_at) &&
        counts.every((key) => number(row[key])) &&
        (row.last_ticket_activity_at === null || timestamp(row.last_ticket_activity_at)),
    )
  );
}

/** Column order and headings shared by every export format. */
export const organizationColumns: {
  heading: string;
  /** Short heading for the narrow PDF table. */
  short: string;
  value: (row: OrganizationExportRow) => string | number;
}[] = [
  { heading: 'Organization', short: 'Organization', value: (row) => row.name },
  { heading: 'Workspace address', short: 'Address', value: (row) => row.slug },
  { heading: 'Timezone', short: 'Timezone', value: (row) => row.timezone },
  { heading: 'Created (UTC)', short: 'Created', value: (row) => row.created_at.slice(0, 10) },
  { heading: 'Active administrators', short: 'Admins', value: (row) => row.administrators },
  { heading: 'Active technicians', short: 'Techs', value: (row) => row.technicians },
  { heading: 'Active employees', short: 'Employees', value: (row) => row.employees },
  { heading: 'Inactive members', short: 'Inactive', value: (row) => row.inactive_members },
  { heading: 'Tickets (all time)', short: 'Tickets', value: (row) => row.tickets_total },
  { heading: 'Open tickets', short: 'Open', value: (row) => row.tickets_open },
  {
    heading: 'Tickets created, last 30 days',
    short: '30 days',
    value: (row) => row.tickets_last_30_days,
  },
  { heading: 'Chats (all time)', short: 'Chats', value: (row) => row.chats_total },
  { heading: 'Assets', short: 'Assets', value: (row) => row.assets_total },
  {
    heading: 'Last ticket activity (UTC)',
    short: 'Last activity',
    value: (row) => row.last_ticket_activity_at?.slice(0, 10) ?? 'None',
  },
];

export function exportScope(
  data: Pick<OrganizationExport, 'search' | 'matchingCount' | 'organizations'>,
) {
  const scope = data.search ? `Organizations matching “${data.search}”` : 'All organizations';
  const truncated = data.matchingCount > data.organizations.length;
  return truncated
    ? `${scope} · first ${data.organizations.length.toLocaleString('en')} of ${data.matchingCount.toLocaleString('en')}, oldest first`
    : `${scope} · ${data.organizations.length.toLocaleString('en')} organization${data.organizations.length === 1 ? '' : 's'}`;
}

export function organizationExportFilename(generatedAt: string, format: string) {
  return `fixxflow-organizations-${generatedAt.slice(0, 10).replace(/[^0-9-]/g, '')}.${format}`;
}
