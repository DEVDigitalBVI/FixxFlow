export type NotificationEmailConfiguration = {
  apiKey: string;
  from: string;
  siteUrl: string;
};

/** Shared by the dispatcher and its readiness indicator; never renders secrets. */
export function parseNotificationEmailConfiguration(config: NotificationEmailConfiguration) {
  const base = new URL(config.siteUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid notification site URL");
  const sender = /^(?:([^<>\r\n]+)\s*<([^<>\s@]+@[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+))$/.exec(config.from.trim());
  if (!sender || /[\r\n]/.test(config.from)) throw new Error("Invalid notification sender");
  return { base, sender };
}

/** Call only with server environment values; a configured provider is not a delivery health check. */
export function getNotificationEmailConfiguration(environment: Record<string, string | undefined>): NotificationEmailConfiguration | null {
  const apiKey = environment.ZOHO_CPAAS_API_KEY?.trim();
  const from = environment.NOTIFICATIONS_FROM_EMAIL;
  const siteUrl = environment.NEXT_PUBLIC_SITE_URL;
  if (!apiKey || !from || !siteUrl || !environment.CRON_SECRET?.trim() || !environment.SUPABASE_SECRET_KEY?.trim()) return null;
  const config = { apiKey, from, siteUrl };
  try {
    parseNotificationEmailConfiguration(config);
    return config;
  } catch {
    return null;
  }
}
