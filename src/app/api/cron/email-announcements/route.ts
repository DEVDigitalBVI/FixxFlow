import { setTimeout as wait } from 'node:timers/promises';

import { sendEmailAnnouncement } from '@/features/email-announcements/email';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const config = getNotificationEmailConfiguration(process.env);
  if (!config) return Response.json({ error: 'Email delivery is not configured' }, { status: 503 });
  try {
    const db = createAdminClient();
    const batch = await db.rpc('claim_email_announcements', { batch_size: 10 });
    if (batch.error) throw batch.error;
    let sent = 0;
    // Keep the bounded batch within this route's deadline and pace provider calls.
    for (const [index, item] of (batch.data ?? []).entries()) {
      if (index) await wait(150);
      let providerId: string | undefined;
      let failed = false;
      try {
        providerId = await sendEmailAnnouncement(item, config);
      } catch (error) {
        failed = true;
        reportServerError('email-announcement.send', error);
      }
      const finished = await db.rpc('finish_email_announcement', {
        campaign: item.campaign_id,
        recipient: item.user_id,
        token: item.lease_token,
        provider_id: providerId,
        failure: failed,
      });
      if (finished.error || !finished.data)
        throw finished.error ?? new Error('Email acknowledgement failed');
      if (providerId) sent++;
    }
    return Response.json({ processed: batch.data?.length ?? 0, sent });
  } catch (error) {
    const reference = reportServerError('email-announcement.dispatch', error);
    return Response.json(
      { error: 'Email announcement processing failed', reference },
      { status: 500 },
    );
  }
}
