import type { PlatformData } from './model';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function timestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isPlatformData(value: unknown): value is PlatformData {
  return record(value) && number(value.organizationCount) && number(value.matchingCount)
    && Array.isArray(value.organizations) && value.organizations.every(row => record(row)
      && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.slug === 'string'
      && timestamp(row.created_at) && number(row.members))
    && Array.isArray(value.usage) && value.usage.every(row => record(row)
      && typeof row.event === 'string' && typeof row.role === 'string' && typeof row.surface === 'string' && number(row.count))
    && Array.isArray(value.audit) && value.audit.every(row => record(row)
      && number(row.id) && typeof row.actor_id === 'string'
      && (row.organization_id === null || typeof row.organization_id === 'string')
      && typeof row.action === 'string' && timestamp(row.created_at)
      && record(row.details) && Object.values(row.details).every(detail => detail === null || typeof detail === 'string'));
}
