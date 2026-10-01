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
  if (Date.parse(observed) >= Date.parse(deadline)) return 'missed_window';
  return Date.parse(observed) - Date.parse(threshold) > operationsPolicy.intervalSeconds * 1000 ? 'late_before_deadline' : 'within_window';
}
export type QueueHealth = { sampled: number; truncated: boolean; ready: number; leased: number; retryScheduled: number; ineligiblePending: number; oldestEligibleAt: string | null; recent: { acknowledged: number; recovered: number; exhausted: number; failed: number; truncated: boolean } };
export type ExecutionSummary = { total: number; completed: number; skipped: number; running: number; actionFailed: number; retryExhausted: number; deliveryFailed: number; truncated: boolean };
export type OperationsHistoryRow = { id: string; rule_id: string; rule_version: number; rule_name: string; trigger_type: string; entity_id: string; ticket_number: number | null; started_at: string; status: string; error_code: string | null; duration_ms: number | null; completed_actions: number; total_actions: number };
export type OperationsOverview = {
  now: string; processingActive: boolean; worker: Heartbeat; discovery: Heartbeat; queue: QueueHealth; executions: ExecutionSummary;
  lag: { sampled: number; truncated: boolean; latestSeconds: number | null; maxSeconds: number | null; withinWindow: number; lateBeforeDeadline: number; missedWindow: number; missedTruncated: boolean };
  temporalRules: { id: string; name: string; version: number; trigger: string; durationMinutes: number | null; lastScannedAt: string | null; atRisk: boolean }[];
  temporalRulesTruncated: boolean;
};
export function queueHealth(active: boolean, queue: QueueHealth, now: string): HealthState {
  if (!active) return 'disabled';
  if (queue.recent.exhausted || queue.recent.failed) return 'degraded';
  if (queue.oldestEligibleAt && Date.parse(now)-Date.parse(queue.oldestEligibleAt)>operationsPolicy.intervalSeconds*(1+operationsPolicy.graceIntervals)*1000) return 'delayed';
  return queue.truncated ? 'unknown' : 'healthy';
}
