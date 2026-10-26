export type NotificationEmailConfiguration = {
  apiKey: string;
  from: string;
  siteUrl: string;
};

/** Shared by the dispatcher and its readiness indicator; never renders secrets. */
export function parseNotificationEmailConfiguration(config: NotificationEmailConfiguration) {
  const base = new URL(config.siteUrl);
  if (base.protocol !== 'https:' || base.username || base.password)
    throw new Error('Invalid notification site URL');
  const sender = /^(?:([^<>\r\n]+)\s*<([^<>\s@]+@[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+))$/.exec(
    config.from.trim(),
  );
  if (!sender || /[\r\n]/.test(config.from)) throw new Error('Invalid notification sender');
  return { base, sender };
}

/** Call only with server environment values; a configured provider is not a delivery health check. */
export function getNotificationEmailConfiguration(
  environment: Record<string, string | undefined>,
): NotificationEmailConfiguration | null {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.NOTIFICATIONS_FROM_EMAIL;
  const siteUrl = environment.NEXT_PUBLIC_SITE_URL;
  if (
    !apiKey ||
    !from ||
    !siteUrl ||
    !environment.CRON_SECRET?.trim() ||
    !environment.SUPABASE_SECRET_KEY?.trim()
  )
    return null;
  const config = { apiKey, from, siteUrl };
  try {
    parseNotificationEmailConfiguration(config);
    return config;
  } catch {
    return null;
  }
}

export type InboundEmailConfiguration = { apiKey: string; webhookSecret: string; domain: string };

/** Email to ticket is off unless the Resend key, inbound webhook secret and domain are all set. */
export function getInboundEmailConfiguration(
  environment: Record<string, string | undefined>,
): InboundEmailConfiguration | null {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const webhookSecret = environment.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  const domain = environment.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!apiKey || !webhookSecret?.startsWith('whsec_') || !domain) return null;
  if (!/^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/.test(domain)) return null;
  return { apiKey, webhookSecret, domain };
}

/** The address a workspace's members email to create or reply to tickets. */
export const inboundAddress = (slug: string, domain: string) => `${slug}@${domain}`;
