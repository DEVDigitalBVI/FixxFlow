import { observeAutomationRun, type RunMetrics } from '@/features/automation/operations-telemetry';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { discoverTemporalAutomation } from '@/features/automation/scheduler';
import { classifyWorkerFailure } from '@/features/automation/worker-failures';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.AUTOMATION_PROCESSING_ENABLED !== 'true') return Response.json({ disabled: true });
  try {
    const client = createAdminClient();
    const result = await observeAutomationRun(client, 'discovery', () => discoverTemporalAutomation(client), result => { const data = result as RunMetrics; return { rules: data.rules ?? 0, examined: data.examined ?? 0, emitted: data.emitted ?? 0, duplicates: data.duplicates ?? 0 }; });
    console.info(JSON.stringify({ component: 'automation_scheduler', result }));
    return Response.json(result);
  } catch (error) {
    console.error(JSON.stringify({ component: 'automation_scheduler', result: 'worker_unavailable', code: classifyWorkerFailure(error).code }));
    return Response.json({ error: 'Automation processing unavailable' }, { status: 503 });
  }
}
