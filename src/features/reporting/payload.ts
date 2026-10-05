import type { Report } from './model';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function timing(value: unknown) {
  return value === null || number(value);
}

/** JSON-returning RPCs need runtime validation in addition to generated types. */
export function isReport(value: unknown): value is Report {
  if (!record(value) || typeof value.asOf !== 'string' || typeof value.timezone !== 'string' || typeof value.today !== 'string') return false;
  const summary = value.summary;
  return record(summary)
    && ['created', 'resolved', 'open', 'overdue'].every(key => number(summary[key]))
    && timing(summary.response) && timing(summary.resolution)
    && Array.isArray(value.daily) && value.daily.every(row => record(row)
      && typeof row.day === 'string' && number(row.created) && number(row.resolved)
      && number(row.reopened) && timing(row.response) && timing(row.resolution))
    && Array.isArray(value.breakdowns) && value.breakdowns.every(row => record(row)
      && typeof row.kind === 'string' && typeof row.label === 'string' && number(row.value))
    && Array.isArray(value.sla) && value.sla.every(row => record(row)
      && typeof row.label === 'string' && number(row.total) && number(row.met));
}
