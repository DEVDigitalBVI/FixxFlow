import type { NotificationEmail } from "@/types/database";
import { notificationHref } from "./presentation";
import { renderEmail } from "./template";

export async function sendNotificationEmail(item: NotificationEmail, config: { apiKey: string; from: string; siteUrl: string }, request: typeof fetch = fetch): Promise<string> {
  const base = new URL(config.siteUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid notification site URL");
  const url = new URL(notificationHref(item), base.origin).href;
  const sender = /^(?:([^<>\r\n]+)\s*<([^<>\s@]+@[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+))$/.exec(config.from.trim());
  if (!sender || /[\r\n]/.test(config.from)) throw new Error("Invalid notification sender");
  const response = await request("https://cpaas.zoho.com/v1.1/email", {
    method: "POST",
    headers: { Authorization: config.apiKey.startsWith("Zoho-enczapikey ") ? config.apiKey : `Zoho-enczapikey ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      from: { address: sender[2] || sender[3], name: sender[1]?.trim() || "FixxFlow" },
      to: [{ email_address: { address: item.recipient_email } }],
      reply_to: [{ address: "support@fixxflow.app", name: "FixxFlow Support" }],
      subject: `FixxFlow: ${item.title}`,
      textbody: `${item.title}\n\nOpen FixxFlow to view this update:\n${url}\n\nSign in to your account to view the conversation.`,
      htmlbody: renderEmail({ title: item.title, message: "There is an update waiting for you in FixxFlow.", action: "View update", href: url, note: "Sign in to your account to view the conversation.", siteUrl: base.origin }),
      // Correlation only: Zoho does not document provider-side idempotency.
      client_reference: `notification/${item.notification_id}`,
      track_opens: false,
      track_clicks: false,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("request_id" in result) || typeof result.request_id !== "string" || !result.request_id) throw new Error("Email provider returned no delivery ID");
  if (!("data" in result) || !Array.isArray(result.data) || result.data.length !== 1 || result.data[0]?.code !== "EM_104") throw new Error("Email provider did not accept the message");
  return result.request_id;
}
