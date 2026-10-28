import {
  parseNotificationEmailConfiguration,
  type NotificationEmailConfiguration,
} from './configuration';
import type { NotificationDigest } from './preferences-model';
import { renderEmail } from './template';

export function digestContent(item: NotificationDigest, siteUrl: string) {
  if (
    !Array.isArray(item.items) ||
    item.total < 1 ||
    item.total > 100 ||
    item.items.length !== item.total
  )
    throw new Error('Invalid digest');
  const titles = item.items.map((value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('title' in value) ||
      typeof value.title !== 'string'
    )
      throw new Error('Invalid digest item');
    return value.title.replace(/\s+/g, ' ').slice(0, 300);
  });
  const href = new URL('/app/notifications', siteUrl).toString();
  const message = `${item.total} ${item.total === 1 ? 'update is' : 'updates are'} waiting for you.\n\n${titles
    .slice(0, 10)
    .map((title) => `• ${title}`)
    .join('\n')}${item.total > 10 ? `\n\nAnd ${item.total - 10} more in FixxFlow.` : ''}`;
  return {
    subject: 'Your daily FixxFlow summary',
    text: `${message}\n\nView updates: ${href}\n\nManage email preferences in Notifications.`,
    html: renderEmail({
      title: 'Your daily summary',
      message,
      action: 'View updates',
      href,
      notificationLabel: 'Daily summary',
      workspaceName: item.workspace_name,
      siteUrl,
      preserveLines: true,
      note: 'Open FixxFlow to reply or change your email preferences.',
    }),
  };
}
export async function sendNotificationDigest(
  item: NotificationDigest,
  config: NotificationEmailConfiguration,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const { base } = parseNotificationEmailConfiguration(config);
  const content = digestContent(item, base.origin);
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `notification-digest/${item.digest_id}`,
    },
    body: JSON.stringify({ from: config.from, to: [item.recipient_email], ...content }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Digest delivery failed');
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('id' in body) ||
    typeof body.id !== 'string' ||
    !body.id.trim()
  )
    throw new Error('Delivery ID missing');
  return body.id;
}
