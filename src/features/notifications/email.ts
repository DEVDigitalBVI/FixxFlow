import { ticketPriorities, ticketStatuses } from "@/features/tickets/presentation";
import type { NotificationEmail, NotificationKind } from "@/types/database";
import { notificationHref } from "./presentation";
import { renderEmail } from "./template";
import { parseNotificationEmailConfiguration, type NotificationEmailConfiguration } from "./configuration";

// Semantic reasons keep the first line, preview and action distinct across events.
const emailReasons: Record<NotificationKind, { label: string; message: string; action: string }> = {
  ticket_created: { label: 'New ticket received', message: 'A new support ticket has been submitted. Review the request and decide who should handle it.', action: 'Review new ticket' },
  ticket_assigned: { label: 'Assigned to you', message: 'You are now responsible for this ticket. Open it to review the request and take the next step.', action: 'Open assigned ticket' },
  ticket_reassigned: { label: 'Ticket assignment changed', message: 'This ticket has been reassigned. Open it to check the current owner and next steps.', action: 'View assignment' },
  ticket_response: { label: 'Your support team replied', message: 'Your support team has added a reply to your ticket. Sign in to read it and respond.', action: 'Read support reply' },
  user_replied: { label: 'Requester replied', message: 'The requester has added a reply to this ticket. Review their response to keep work moving.', action: 'Read requester reply' },
  ticket_resolved: { label: 'Ticket resolved', message: 'This ticket has been resolved. Open it to review the outcome.', action: 'Review resolution' },
  ticket_reopened: { label: 'Ticket reopened', message: 'This ticket has been reopened and needs further attention.', action: 'Open reopened ticket' },
  sla_approaching: { label: 'SLA deadline approaching', message: 'An SLA deadline for this ticket is approaching. Review the ticket and its next required action.', action: 'Review SLA deadline' },
  new_chat: { label: 'New support chat', message: 'A new support conversation is waiting for attention.', action: 'Open new chat' },
  chat_response: { label: 'New chat reply', message: 'There is a new reply in your support conversation. Sign in to read it.', action: 'Read chat reply' },
  automation_update: { label: 'Automation update', message: 'An automation has updated this ticket. Review its activity for details.', action: 'Review ticket activity' },
  incident_update: { label: 'IT update', message: 'An approved IT update is available.', action: 'View approved update' },
  incident_update_due: { label: 'Stakeholder update due', message: 'A stakeholder update is due for this ticket. Review the communication plan and prepare the next update.', action: 'Prepare stakeholder update' },
  incident_escalation: { label: 'Workflow escalation', message: 'This ticket has been escalated. Review its workflow and the next required action.', action: 'Review escalation' },
  incident_approval: { label: 'Approval needed', message: 'A workflow step requires your approval. Review the request before deciding.', action: 'Review approval request' },
  incident_step_assigned: { label: 'Response step assigned', message: 'You have been assigned a response step. Open the ticket to review the work required.', action: 'Review assigned step' },
};

export async function sendNotificationEmail(item: NotificationEmail, config: NotificationEmailConfiguration, request: typeof fetch = fetch): Promise<string> {
  const { base } = parseNotificationEmailConfiguration(config);
  const url = new URL(notificationHref(item), base.origin).href;
  const incident = Boolean(item.incident_bulletin_id && item.approved_body);
  const reason = item.email_kind ? emailReasons[item.email_kind] : undefined;
  const reply = Boolean(!incident && item.ticket_id && !item.conversation_id && ['ticket_response', 'user_replied'].includes(item.email_kind ?? '') && item.reply_preview);
  const statusUpdate = Boolean(!incident && item.ticket_id && !item.conversation_id && ['ticket_resolved', 'ticket_reopened'].includes(item.email_kind ?? '') && item.ticket_status && item.status_changed_by);
  const statusLabel = item.ticket_status ? ticketStatuses[item.ticket_status].label : undefined;
  const label = statusUpdate ? item.ticket_status === 'closed' ? 'Ticket closed' : reason?.label : reply && item.reply_author ? `${item.reply_author} replied` : reason?.label;
  const action = reply ? 'Read reply and respond' : reason?.action;
  const details: { label: string; value: string }[] = [];
  if (!incident && ['ticket_created', 'ticket_assigned', 'ticket_reassigned'].includes(item.email_kind ?? '') && item.ticket_priority) {
    details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  if (reply) {
    if (item.reply_author) details.push({ label: 'From', value: item.reply_author });
    if (item.reply_created_at) details.push({ label: 'Replied at', value: `${new Intl.DateTimeFormat('en', {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.reply_created_at))} UTC` });
    if (item.ticket_status) details.push({ label: 'Status at reply', value: ticketStatuses[item.ticket_status].label });
    if (item.ticket_priority) details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  if (statusUpdate) {
    if (item.previous_status) details.push({ label: 'Previous status', value: ticketStatuses[item.previous_status].label });
    details.push({ label: 'New status', value: statusLabel! });
    details.push({ label: 'Changed by', value: item.status_changed_by! });
    if (item.event_created_at) details.push({ label: 'Changed at', value: `${new Intl.DateTimeFormat('en', {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.event_created_at))} UTC` });
    if (item.ticket_owner) details.push({ label: 'Owner', value: item.ticket_owner });
    if (item.ticket_priority) details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  const reopenReason = !incident && item.email_kind === 'ticket_reopened' ? item.reopen_reason : null;
  const subject = reason && !incident ? `${label}: ${item.title}` : item.title;
  const message = incident ? item.approved_body! : statusUpdate ? `The ticket status changed${item.previous_status ? ` from ${ticketStatuses[item.previous_status].label}` : ""} to ${statusLabel}. ${item.email_kind === "ticket_reopened" ? "Further work is needed. Open the ticket to review the next steps." : "Review the outcome in FixxFlow. If the issue continues, return to the ticket to follow up."}` : reason?.message ?? "There is an update waiting for you in FixxFlow.";
  const nextUpdate = incident && item.next_update_at ? ` Next update expected: ${new Intl.DateTimeFormat('en', {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.next_update_at))} UTC.` : '';
  const note = incident ? `You received this approved update as a selected stakeholder.${nextUpdate}` : reply ? "Reply in FixxFlow to keep the conversation with the ticket. This email shows a short preview of the public reply." : "Sign in to your account to view the conversation.";
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
      subject: `FixxFlow: ${subject}`,
      text: incident ? `${item.title}\n\n${message}\n\n${note}\n\nView approved update:\n${url}` : reason ? `${label}\n${item.title}\n\n${message}${details.length ? `\n\n${details.map(detail => `${detail.label}: ${detail.value}`).join("\n")}${reply ? `\n\nReply preview:\n${item.reply_preview}` : ""}` : ""}${reopenReason ? `\n\nReason for reopening:\n${reopenReason}` : ""}\n\n${action}:\n${url}\n\n${note}` : `${item.title}\n\nOpen FixxFlow to view this update:\n${url}\n\nSign in to your account to view the conversation.`,
      html: renderEmail({ title: reason && !incident ? label! : item.title, message: reason && !incident ? `${item.title}\n\n${message}` : message, action: incident ? "View approved update" : action ?? "View update", href: url, note, preserveLines: incident || Boolean(reason), siteUrl: base.origin, notificationLabel: statusUpdate ? "Ticket status update" : reply ? "New public reply" : reason && !incident ? "Workspace notification" : undefined, details, reopenReason: reopenReason ?? undefined, replyPreview: reply ? item.reply_preview! : undefined }),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id.trim()) throw new Error("Email provider returned no delivery ID");
  return result.id;
}
