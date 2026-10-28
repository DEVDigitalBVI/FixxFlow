import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Daily product-analytics retention: expired dedup keys and counters past 365 days. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await createAdminClient().rpc('run_product_usage_cleanup', { row_limit: 50000 });
    if (result.error) throw result.error;
    return Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const reference = reportServerError('analytics.cleanup', error);
    return Response.json({ error: 'Analytics cleanup could not run', reference }, { status: 500 });
  }
}
