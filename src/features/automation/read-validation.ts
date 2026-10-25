import type { OperationsHistoryRow, OperationsOverview } from './operations-model';
import type { Choice } from './ui-model';
import type { AutomationListRow, EventChoice } from './ui-service';
import { isRecord, isTimestamp, isUuid } from './values';

type Check = (value: unknown) => boolean;
const string: Check = (value) => typeof value === 'string';
const boolean: Check = (value) => typeof value === 'boolean';
const count: Check = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const number: Check = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value);
const array =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);
const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    isRecord(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const result: Check = (value) =>
  value === null ||
  (typeof value === 'string' && ['succeeded', 'degraded', 'failed'].includes(value));
const heartbeat = shape({
  lastStartedAt: nullable(isTimestamp),
  lastCompletedAt: nullable(isTimestamp),
  lastSuccessfulAt: nullable(isTimestamp),
  latestResult: (value) => value === 'running' || result(value),
  latestStartedAt: nullable(isTimestamp),
  latestCompletedResult: result,
});
const overview = shape({
  now: isTimestamp,
  processingActive: boolean,
  worker: heartbeat,
  discovery: heartbeat,
  queue: shape({
    sampled: count,
    truncated: boolean,
    ready: count,
    leased: count,
    retryScheduled: count,
    ineligiblePending: count,
    oldestEligibleAt: nullable(isTimestamp),
    capacityDeferred: optional(count),
    notificationDeferred: optional(count),
    oldestCapacityDeferredAt: optional(nullable(isTimestamp)),
    recent: shape({
      acknowledged: count,
      recovered: count,
      exhausted: count,
      failed: count,
      truncated: boolean,
      guardrailTerminated: optional(count),
    }),
  }),
  executions: shape({
    total: count,
    completed: count,
    skipped: count,
    running: count,
    actionFailed: count,
    retryExhausted: count,
    deliveryFailed: count,
    truncated: boolean,
    guardrailTerminated: optional(count),
  }),
  lag: shape({
    sampled: count,
    truncated: boolean,
    latestSeconds: nullable(number),
    maxSeconds: nullable(number),
    withinWindow: count,
    lateBeforeDeadline: count,
    missedWindow: count,
    missedTruncated: boolean,
  }),
  temporalRules: array(
    shape({
      id: isUuid,
      name: string,
      version: count,
      trigger: string,
      durationMinutes: nullable(number),
      lastScannedAt: nullable(isTimestamp),
      atRisk: boolean,
    }),
  ),
  temporalRulesTruncated: boolean,
});
export const isOperationsOverview = (value: unknown): value is OperationsOverview =>
  overview(value);
const historyRow = shape({
  id: isUuid,
  rule_id: isUuid,
  rule_version: count,
  rule_name: string,
  trigger_type: string,
  entity_id: isUuid,
  ticket_number: nullable(count),
  started_at: isTimestamp,
  status: string,
  error_code: nullable(string),
  duration_ms: nullable(number),
  completed_actions: count,
  total_actions: count,
});
export const isOperationsHistory = (
  value: unknown,
): value is { rows: OperationsHistoryRow[]; hasNext: boolean; since: string; until: string } =>
  shape({ rows: array(historyRow), hasNext: boolean, since: isTimestamp, until: isTimestamp })(
    value,
  );
export const isAdminEnvelope = (
  value: unknown,
): value is { rows: unknown[]; processingActive?: boolean } =>
  shape({ rows: Array.isArray, processingActive: optional(boolean) })(value);
export const isAutomationListRow = (value: unknown): value is AutomationListRow =>
  shape({
    id: isUuid,
    name: string,
    enabled: boolean,
    version: count,
    trigger_type: string,
    updated_at: isTimestamp,
    archived_at: nullable(isTimestamp),
    run_count: count,
    last_run: nullable(
      shape({ started_at: isTimestamp, status: string, error_code: nullable(string) }),
    ),
  })(value);
export const isChoice = (value: unknown): value is Choice =>
  shape({ id: isUuid, label: string, active: boolean, parentId: optional(nullable(isUuid)) })(
    value,
  );
export const isEventChoice = (value: unknown): value is EventChoice =>
  shape({ id: isUuid, event_type: string, occurred_at: isTimestamp, entity_version: count })(value);
export function checkedRows<T>(rows: unknown[], check: (value: unknown) => value is T): T[] {
  if (!rows.every(check))
    throw new Error('Automation information could not load. Please try again.');
  return rows;
}
