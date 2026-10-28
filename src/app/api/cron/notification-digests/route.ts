import { randomUUID } from 'node:crypto';

import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { sendNotificationDigest } from '@/features/notifications/digest-email';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const config = getNotificationEmailConfiguration(process.env);
  if (!config) return Response.json({ error: 'Email delivery is not configured' }, { status: 503 });
  const correlationId = randomUUID();
  try {
    const db = createAdminClient();
    const batch = await db.rpc('claim_notification_digests', { batch_size: 3 });
    if (batch.error) throw batch.error;
    let sent = 0;
    for (const item of batch.data ?? []) {
      let provider: string | null = null;
      try {
        provider = await sendNotificationDigest(item, config);
      } catch (error) {
        reportServerError('notification.send', error, correlationId);
      }
      const finished = await db.rpc('finish_notification_digest', {
        target: item.digest_id,
        token: item.lease_token,
        provider_message_id: provider,
        failure: provider === null,
      });
      if (finished.error || !finished.data)
        throw finished.error ?? new Error('Digest acknowledgement failed');
      if (provider) sent++;
    }
    return Response.json(
      { processed: batch.data?.length ?? 0, sent },
      { headers: { 'X-Correlation-ID': correlationId } },
    );
  } catch (error) {
    reportServerError('notification.dispatch', error, correlationId);
    return Response.json(
      { error: 'Digest processing failed', reference: correlationId },
      { status: 500 },
    );
  }
}
