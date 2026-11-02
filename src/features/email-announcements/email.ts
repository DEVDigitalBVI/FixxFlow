import {
  parseNotificationEmailConfiguration,
  type NotificationEmailConfiguration,
} from '@/features/notifications/configuration';
import { renderEmail } from '@/features/notifications/template';

import type { EmailAnnouncementDelivery } from './model';

export async function sendEmailAnnouncement(
  item: EmailAnnouncementDelivery,
  config: NotificationEmailConfiguration,
  request: typeof fetch = fetch,
) {
  const { base } = parseNotificationEmailConfiguration(config);
  const url = new URL('/app', base.origin).href;
  const note = 'Your company sent this update to registered members in your workspace.';
  const response = await request('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(4_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `email-announcement/${item.campaign_id}/${item.user_id}`,
    },
    body: JSON.stringify({
      from: config.from.trim(),
      to: [item.recipient_email],
      subject: `FixxFlow: ${item.subject}`,
      text: `${item.subject}\n\n${item.body}\n\n${note}\n\nOpen FixxFlow:\n${url}`,
      html: await renderEmail({
        title: item.subject,
        message: item.body,
        preserveLines: true,
        workspaceName: item.workspace_name,
        notificationLabel: 'Company announcement',
        note,
        action: 'Open FixxFlow',
        href: url,
        siteUrl: base.origin,
      }),
    }),
  });
  if (!response.ok) throw new Error('Email announcement provider request failed');
  const result = await response.json();
  if (typeof result.id !== 'string' || !result.id) throw new Error('Missing email receipt');
  return result.id as string;
}
