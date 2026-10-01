import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
export type RunMetrics = { claimed?: number; executions?: number; failures?: number; retried?: number; deferred?: number; acknowledged?: number; rules?: number; examined?: number; emitted?: number; duplicates?: number };
/** Observation failures never provide or remove execution authority. */
export async function observeAutomationRun<T>(client: SupabaseClient<Database>, kind: 'worker' | 'discovery', work: () => Promise<T>, metrics: (result: T) => RunMetrics): Promise<T> {
  let runId: string | null = null;
  const unavailable = () => console.error(JSON.stringify({ component: 'automation_operations', kind, result: 'telemetry_unavailable' }));
  try { const result = await client.rpc('start_automation_run', { kind }); if (result.error) unavailable(); else runId = result.data; } catch { unavailable(); }
  const finish = async (outcome: string, counts: RunMetrics) => {
    if (!runId) return;
    try { const result = await client.rpc('finish_automation_run', { run_id: runId, outcome, metrics: counts as Json }); if (result.error || !result.data) unavailable(); } catch { unavailable(); }
  };
  let value: T;
  try { value = await work(); }
  catch (error) { await finish('failed', { failures: 1 }); throw error; }
  let counts: RunMetrics;
  try { counts = metrics(value); } catch { unavailable(); return value; }
  await finish((counts.failures ?? 0) + (counts.retried ?? 0) + (counts.deferred ?? 0) > 0 ? 'degraded' : 'succeeded', counts);
  return value;
}
