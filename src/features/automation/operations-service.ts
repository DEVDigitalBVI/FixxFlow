import 'server-only';
import { requireAutomationAdmin } from './ui-service';
import { createClient } from '@/lib/supabase/server';
import { normalizeSearch } from '@/lib/search';
import { isUuid } from './values';
import type { OperationsOverview, OperationsHistoryRow } from './operations-model';
export type OperationsFilters = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
const unavailable = () => new Error('Automation operations could not load. Please try again.');
export async function automationOperations(): Promise<OperationsOverview> {
  const viewer = await requireAutomationAdmin(), client = await createClient();
  const { data, error } = await client.rpc('read_automation_operations', { org: viewer.organizationId });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  const result = data as unknown as OperationsOverview;
  return { ...result, processingActive: process.env.AUTOMATION_PROCESSING_ENABLED === 'true' && result.processingActive };
}
export function operationsHistoryFilters(input: OperationsFilters) {
  const result = text(input.result) || 'all', query = normalizeSearch(input.q).slice(0,120), trigger = text(input.trigger);
  const from = text(input.from), to = text(input.to), beforeAt = text(input.before), beforeId = text(input.cursor), number = text(input.ticket);
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
  let error = '';
  if ((from && !validDate(from)) || (to && !validDate(to))) error = 'Choose valid dates.';
  const since = from && validDate(from) ? `${from}T00:00:00Z` : text(input.since) || null;
  const until = to && validDate(to) ? new Date(Date.parse(to)+86400000).toISOString() : text(input.until) || null;
  if ([since,until,beforeAt || null].some(value => value && !Number.isFinite(Date.parse(value)))) error = 'Choose valid dates.';
  if (since && until && (Date.parse(since)>=Date.parse(until) || Date.parse(until)-Date.parse(since)>31*86400000)) error = 'Choose a time range of up to 31 days.';
  if (Boolean(beforeAt)!==Boolean(beforeId) || (beforeId && !isUuid(beforeId))) error = 'This history page is unavailable. Start from the newest results.';
  if (number && (!/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)) || Number(number)<1)) error = 'Enter a valid ticket number.';
  if (!['all','succeeded','skipped','running','action_failed','retry_exhausted','delivery_failed','guardrail','failures'].includes(result)) error = 'Choose an available execution result.';
  return { query, trigger, result, from, to, ticket: number, since, until, beforeAt: beforeAt || null, beforeId: beforeId || null, error };
}
export async function automationOperationsHistory(input: OperationsFilters) {
  const viewer = await requireAutomationAdmin(), filters = operationsHistoryFilters(input);
  if (filters.error) return { rows: [] as OperationsHistoryRow[], hasNext: false, since: filters.since, until: filters.until, filters, error: filters.error };
  const client = await createClient();
  const { data, error } = await client.rpc('read_automation_operations_history', { org: viewer.organizationId, query: filters.query, trigger_type: filters.trigger, result_filter: filters.result, since_at: filters.since, until_at: filters.until, before_at: filters.beforeAt, before_id: filters.beforeId, ticket_number: filters.ticket ? Number(filters.ticket) : null });
  if (error?.code === '22023') return { rows: [] as OperationsHistoryRow[], hasNext: false, since: filters.since, until: filters.until, filters, error: 'Choose a valid time range of up to 31 days.' };
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  return { ...data as unknown as { rows: OperationsHistoryRow[]; hasNext: boolean; since: string; until: string }, filters, error: '' };
}
