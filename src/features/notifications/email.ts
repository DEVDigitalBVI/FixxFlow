import type { NotificationEmail } from "@/types/database";
import { notificationHref } from "./presentation";
import { renderEmail } from "./template";
import { parseNotificationEmailConfiguration, type NotificationEmailConfiguration } from "./configuration";

export async function sendNotificationEmail(item: NotificationEmail, config: NotificationEmailConfiguration, request: typeof fetch = fetch): Promise<string> {
  const { base } = parseNotificationEmailConfiguration(config);
  const url = new URL(notificationHref(item), base.origin).href;
  const incident = Boolean(item.incident_bulletin_id && item.approved_body);
  const message = incident ? item.approved_body! : "There is an update waiting for you in FixxFlow.";
  const nextUpdate = incident && item.next_update_at ? ` Next update expected: ${new Intl.DateTimeFormat('en', {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.next_update_at))} UTC.` : '';
  const note = incident ? `You received this approved update as a selected stakeholder.${nextUpdate}` : "Sign in to your account to view the conversation.";
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // Reuse across queue leases and ambiguous failures; Resend retains keys for 24 hours.
      "Idempotency-Key": `notification/${item.notification_id}`,
    },
    body: JSON.stringify({
      from: config.from.trim(),
      to: [item.recipient_email],
      reply_to: "support@fixxflow.app",
      subject: `FixxFlow: ${item.title}`,
      text: incident ? `${item.title}\n\n${message}\n\n${note}\n\nView approved update:\n${url}` : `${item.title}\n\nOpen FixxFlow to view this update:\n${url}\n\nSign in to your account to view the conversation.`,
      html: renderEmail({ title: item.title, message, action: incident ? "View approved update" : "View update", href: url, note, preserveLines: incident, siteUrl: base.origin }),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id.trim()) throw new Error("Email provider returned no delivery ID");
  return result.id;
}
