import 'server-only';

import { setTimeout as wait } from 'node:timers/promises';

import { sendEmailAnnouncement } from '@/features/email-announcements/email';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

// Used after a confirmed send and by the scheduled recovery worker.
export async function dispatchEmailAnnouncements() {
  const config = getNotificationEmailConfiguration(process.env);
  if (!config) throw new Error('Email delivery is not configured');
  const db = createAdminClient();
  let sent = 0;
  let processed = 0;
  const deadline = Date.now() + 40_000;
  // Claim only work we can start now; leave the rest available to the cron fallback.
  while (processed < 50 && Date.now() < deadline) {
    if (processed) await wait(600);
    const batch = await db.rpc('claim_email_announcements', { batch_size: 1 });
    if (batch.error) throw batch.error;
    const item = batch.data?.[0];
    if (!item) break;
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
    processed++;
    if (providerId) sent++;
    // Let database backoff handle provider trouble instead of exhausting the queue.
    if (failed) break;
  }
  return { processed, sent };
}

export async function startEmailAnnouncementDelivery() {
  try {
    await dispatchEmailAnnouncements();
  } catch (error) {
    reportServerError('email-announcement.dispatch', error);
  }
}
