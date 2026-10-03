/** Operational policy follows both minute cron schedules and their 60s ceilings. */
export const operationsPolicy = { intervalSeconds: 60, runtimeSeconds: 60, graceIntervals: 2, sampleLimit: 1000, recentHours: 24 } as const;
export type HealthState = 'healthy' | 'delayed' | 'degraded' | 'disabled' | 'unknown';
export const healthLabels: Record<HealthState, string> = { healthy: 'Healthy', delayed: 'Delayed', degraded: 'Degraded', disabled: 'Disabled', unknown: 'Unknown' };
export type Heartbeat = { lastStartedAt: string | null; lastCompletedAt: string | null; lastSuccessfulAt: string | null; latestResult: 'running' | 'succeeded' | 'degraded' | 'failed' | null; latestStartedAt: string | null; latestCompletedResult: 'succeeded' | 'degraded' | 'failed' | null };
export function serviceHealth(enabled: boolean, heartbeat: Heartbeat, now: string): HealthState {
  if (!enabled) return 'disabled';
  if (!heartbeat.lastStartedAt) return 'unknown';
  const age = (value: string) => (Date.parse(now) - Date.parse(value)) / 1000;
  if (heartbeat.latestResult === 'running' && age(heartbeat.lastStartedAt) > operationsPolicy.runtimeSeconds + operationsPolicy.intervalSeconds) return 'delayed';
  if (age(heartbeat.lastStartedAt) > operationsPolicy.intervalSeconds * (1 + operationsPolicy.graceIntervals)) return 'delayed';
  if (heartbeat.latestCompletedResult === 'failed' || heartbeat.latestCompletedResult === 'degraded') return 'degraded';
  if (!heartbeat.lastSuccessfulAt) return 'unknown';
  return age(heartbeat.lastSuccessfulAt) <= operationsPolicy.intervalSeconds * (1 + operationsPolicy.graceIntervals) ? 'healthy' : 'delayed';
}
export function approachingWindow(threshold: string, deadline: string, observed: string): 'within_window' | 'late_before_deadline' | 'missed_window' {
  // Match PostgreSQL microsecond boundaries; operational classification must not
  // round an observation just before a deadline into a missed window.
  const micros = (value: string) => BigInt(Date.parse(value))*1000n + BigInt((/\.(\d+)(?:Z|[+-])/.exec(value)?.[1] ?? '').padEnd(6,'0').slice(3,6));
  if (micros(observed) >= micros(deadline)) return 'missed_window';
  return micros(observed) - micros(threshold) > BigInt(operationsPolicy.intervalSeconds) * 1000000n ? 'late_before_deadline' : 'within_window';
}
export type QueueHealth = { capacityDeferred?: number; notificationDeferred?: number; oldestCapacityDeferredAt?: string | null; sampled: number; truncated: boolean; ready: number; leased: number; retryScheduled: number; ineligiblePending: number; oldestEligibleAt: string | null; recent: { guardrailTerminated?: number; acknowledged: number; recovered: number; exhausted: number; failed: number; truncated: boolean } };
export type ExecutionSummary = { guardrailTerminated?: number; total: number; completed: number; skipped: number; running: number; actionFailed: number; retryExhausted: number; deliveryFailed: number; truncated: boolean };
export type OperationsHistoryRow = { id: string; rule_id: string; rule_version: number; rule_name: string; trigger_type: string; entity_id: string; ticket_number: number | null; started_at: string; status: string; error_code: string | null; duration_ms: number | null; completed_actions: number; total_actions: number };
export type OperationsOverview = {
  now: string; processingActive: boolean; worker: Heartbeat; discovery: Heartbeat; queue: QueueHealth; executions: ExecutionSummary;
  lag: { sampled: number; truncated: boolean; latestSeconds: number | null; maxSeconds: number | null; withinWindow: number; lateBeforeDeadline: number; missedWindow: number; missedTruncated: boolean };
  temporalRules: { id: string; name: string; version: number; trigger: string; durationMinutes: number | null; lastScannedAt: string | null; atRisk: boolean }[];
  temporalRulesTruncated: boolean;
};
export function queueHealth(active: boolean, queue: QueueHealth, now: string): HealthState {
  if (!active) return 'disabled';
  if (queue.recent.exhausted || queue.recent.failed || queue.recent.guardrailTerminated) return 'degraded';
  if (queue.capacityDeferred) return 'delayed';
  if (queue.oldestEligibleAt && Date.parse(now)-Date.parse(queue.oldestEligibleAt)>operationsPolicy.intervalSeconds*(1+operationsPolicy.graceIntervals)*1000) return 'delayed';
  return queue.truncated || queue.recent.truncated ? 'unknown' : 'healthy';
}
