import 'server-only';

import {
  parseNotificationEmailConfiguration,
  type NotificationEmailConfiguration,
} from '@/features/notifications/configuration';
import { renderEmail } from '@/features/notifications/template';

export async function sendScheduledReportEmail({
  deliveryId,
  reportId,
  reportName,
  workspaceName,
  recipient,
  filename,
  bytes,
  mime,
  config,
  request = fetch,
}: {
  deliveryId: string;
  reportId: string;
  reportName: string;
  workspaceName?: string;
  recipient: string;
  filename: string;
  bytes: Uint8Array;
  mime: string;
  config: NotificationEmailConfiguration;
  request?: typeof fetch;
}) {
  const { base } = parseNotificationEmailConfiguration(config),
    href = new URL(`/app/reports/saved/${reportId}`, base.origin).href;
  const response = await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': `scheduled-report/${deliveryId}`,
    },
    body: JSON.stringify({
      from: config.from.trim(),
      to: [recipient],
      reply_to: 'support@fixxflow.app',
      subject: `FixxFlow report: ${reportName}`,
      text: `Your scheduled FixxFlow report is attached.\n\nOpen the live report: ${href}`,
      html: await renderEmail({
        workspaceName,
        notificationLabel: 'Scheduled report',
        title: reportName,
        message:
          'Your scheduled FixxFlow report is ready. The requested file is attached to this email.',
        action: 'Open live report',
        href,
        note: 'The attachment is a point-in-time snapshot. Open FixxFlow for refreshed results.',
        siteUrl: base.origin,
      }),
      attachments: [
        { filename, content: Buffer.from(bytes).toString('base64'), content_type: mime },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('id' in result) ||
    typeof result.id !== 'string' ||
    !result.id.trim()
  )
    throw new Error('Email provider returned no delivery ID');
  return result.id;
}
