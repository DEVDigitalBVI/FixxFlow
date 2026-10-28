import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await createAdminClient().rpc('process_equipment_reminders', {
      batch_size: 100,
    });
    if (result.error) throw result.error;
    return Response.json({ checked: result.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      {
        error: 'Equipment reminders could not be processed',
        reference: reportServerError('equipment.reminders', error),
      },
      { status: 500 },
    );
  }
}
