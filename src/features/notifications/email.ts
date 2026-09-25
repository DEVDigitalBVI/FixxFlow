import type { NotificationEmail } from "@/types/database";
import { notificationHref } from "./presentation";

export async function sendNotificationEmail(item: NotificationEmail, config: { apiKey: string; from: string; siteUrl: string }, request: typeof fetch = fetch): Promise<string> {
  const base = new URL(config.siteUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid notification site URL");
  const url = new URL(notificationHref(item), base.origin).href;
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `notification/${item.notification_id}` },
    body: JSON.stringify({ from: config.from, to: [item.recipient_email], subject: `FixxFlow: ${item.title}`, text: `${item.title}\n\nOpen FixxFlow to view this update:\n${url}\n\nSign in to your account to view the conversation.` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) throw new Error("Email provider returned no delivery ID");
  return result.id;
}
