import { observeAutomationRun } from '@/features/automation/operations-telemetry';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { automationWorkerRepository } from '@/features/automation/worker-repository';
import { runAutomationWorker } from '@/features/automation/worker';
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
    const client = createAdminClient(), executions = new Set<string>(), failures = new Set<string>();
    const result = await observeAutomationRun(client, 'worker', () => runAutomationWorker(automationWorkerRepository(client), {
      enabled: true, log: entry => {
        if (entry.executionId) executions.add(entry.executionId);
        if (entry.executionId && ['failed', 'partially_completed'].includes(entry.result)) failures.add(entry.executionId);
        console.info(JSON.stringify({ component: 'automation', ...entry }));
      },
    }), result => ({ claimed: result.claimed, acknowledged: result.acknowledged, retried: result.retried, deferred: result.deferred, executions: executions.size, failures: failures.size + result.failed }));
    return Response.json(result);
  } catch (error) {
    console.error(JSON.stringify({ component: 'automation', result: 'worker_unavailable', code: classifyWorkerFailure(error).code }));
    return Response.json({ error: 'Automation processing unavailable' }, { status: 503 });
  }
}
