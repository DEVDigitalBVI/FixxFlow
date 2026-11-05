import type { WorkloadRow } from '@/features/reporting/dashboard-insights';
import type { Report } from '@/features/reporting/model';
import { isReport } from '@/features/reporting/payload';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { isFiniteNumber, isObjectRecord } from '@/lib/validation';
import type { TicketPriority, TicketStatus } from '@/types/database';

export type InsightAccess = { dashboard: boolean; sharedIncidents: boolean };
export type MemberInsightAccess = InsightAccess & { userId: string; revision: number };
export type SharedIncident = {
  ticket_id: string;
  ticket_number: number;
  title: string;
  overview: string;
  resolution: string;
  status: TicketStatus;
  priority: TicketPriority;
  ticket_type: string;
  published: boolean;
  revision: number;
  updated_at: string;
};
export function isInsightAccess(value: unknown): value is InsightAccess {
  return (
    isObjectRecord(value) &&
    typeof value.dashboard === 'boolean' &&
    typeof value.sharedIncidents === 'boolean'
  );
}
export function isMemberAccess(value: unknown): value is MemberInsightAccess[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isObjectRecord(row) &&
        typeof row.userId === 'string' &&
        Number.isInteger(row.revision) &&
        isInsightAccess(row),
    )
  );
}
export function isSharedFeed(value: unknown): value is { count: number; rows: SharedIncident[] } {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.count) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) =>
        isObjectRecord(row) &&
        ['ticket_id', 'title', 'overview', 'resolution', 'ticket_type', 'updated_at'].every(
          (key) => typeof row[key] === 'string',
        ) &&
        isFiniteNumber(row.ticket_number) &&
        typeof row.published === 'boolean' &&
        Number.isInteger(row.revision) &&
        typeof row.status === 'string' &&
        Object.hasOwn(ticketStatuses, row.status) &&
        typeof row.priority === 'string' &&
        Object.hasOwn(ticketPriorities, row.priority),
    )
  );
}
export function isDashboard(
  value: unknown,
): value is { report: Report; workload: Omit<WorkloadRow, 'user_id'>[] } {
  return (
    isObjectRecord(value) &&
    isReport(value.report) &&
    Array.isArray(value.workload) &&
    value.workload.every(
      (row) =>
        isObjectRecord(row) &&
        typeof row.label === 'string' &&
        typeof row.active === 'boolean' &&
        ['open_count', 'waiting_count', 'overdue_count'].every((key) => isFiniteNumber(row[key])),
    )
  );
}
