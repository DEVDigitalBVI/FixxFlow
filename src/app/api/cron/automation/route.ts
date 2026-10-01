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
    const result = await runAutomationWorker(automationWorkerRepository(createAdminClient()), {
      enabled: true, log: entry => console.info(JSON.stringify({ component: 'automation', ...entry })),
    });
    return Response.json(result);
  } catch (error) {
    console.error(JSON.stringify({ component: 'automation', result: 'worker_unavailable', code: classifyWorkerFailure(error).code }));
    return Response.json({ error: 'Automation processing unavailable' }, { status: 503 });
  }
}
