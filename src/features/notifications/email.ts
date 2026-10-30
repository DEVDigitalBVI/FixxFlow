import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import type { NotificationEmail, NotificationKind } from '@/types/database';

import {
  parseNotificationEmailConfiguration,
  type NotificationEmailConfiguration,
} from './configuration';
import { notificationHref } from './presentation';
import { renderEmail } from './template';

// Semantic reasons keep the first line, preview and action distinct across events.
const emailReasons: Record<NotificationKind, { label: string; message: string; action: string }> = {
  asset_lifecycle: {
    label: 'Equipment lifecycle reminder',
    message:
      'An equipment warranty or end-of-life date needs attention. Review the asset and plan the next step.',
    action: 'Review equipment',
  },
  inventory_low_stock: {
    label: 'Stock needs replenishing',
    message:
      'Available stock has reached its reorder threshold. Review the item and arrange replenishment.',
    action: 'Review inventory',
  },
  ticket_created: {
    label: 'New ticket received',
    message:
      'A new support ticket has been submitted. Review the request and decide who should handle it.',
    action: 'Review new ticket',
  },
  ticket_assigned: {
    label: 'Assigned to you',
    message:
      'You are now responsible for this ticket. Open it to review the request and take the next step.',
    action: 'Open assigned ticket',
  },
  ticket_reassigned: {
    label: 'Ticket assignment changed',
    message: 'This ticket has been reassigned. Open it to check the current owner and next steps.',
    action: 'View assignment',
  },
  ticket_response: {
    label: 'Your support team replied',
    message: 'Your support team has added a reply to your ticket. Sign in to read it and respond.',
    action: 'Read support reply',
  },
  user_replied: {
    label: 'Requester replied',
    message:
      'The requester has added a reply to this ticket. Review their response to keep work moving.',
    action: 'Read requester reply',
  },
  ticket_resolved: {
    label: 'Ticket resolved',
    message: 'This ticket has been resolved. Open it to review the outcome.',
    action: 'Review resolution',
  },
  ticket_reopened: {
    label: 'Ticket reopened',
    message: 'This ticket has been reopened and needs further attention.',
    action: 'Open reopened ticket',
  },
  sla_approaching: {
    label: 'SLA deadline approaching',
    message:
      'An SLA deadline for this ticket is approaching. Review the ticket and its next required action.',
    action: 'Review SLA deadline',
  },
  chat_idle_warning: {
    label: 'Your chat needs a reply',
    message:
      'IT has replied to your chat. Reply within the next 4 support hours to keep it open. Support hours are 7 AM–10 PM every day in your workspace timezone.',
    action: 'Reply to chat',
  },
  chat_auto_closed: {
    label: 'Chat closed after inactivity',
    message:
      'Your chat closed after 24 support hours without a reply. Its history and closing summary are available in FixxFlow. Start a new chat if you still need help.',
    action: 'View chat summary',
  },
  new_chat: {
    label: 'New support chat',
    message: 'A new support conversation is waiting for attention.',
    action: 'Open new chat',
  },
  chat_response: {
    label: 'New chat reply',
    message: 'There is a new reply in your support conversation. Sign in to read it.',
    action: 'Read chat reply',
  },
  automation_update: {
    label: 'Automation update',
    message: 'An automation has updated this ticket. Review its activity for details.',
    action: 'Review ticket activity',
  },
  incident_update: {
    label: 'IT update',
    message: 'An approved IT update is available.',
    action: 'View approved update',
  },
  incident_update_due: {
    label: 'Stakeholder update due',
    message:
      'A stakeholder update is due for this ticket. Review the communication plan and prepare the next update.',
    action: 'Prepare stakeholder update',
  },
  incident_escalation: {
    label: 'Workflow escalation',
    message: 'This ticket has been escalated. Review its workflow and the next required action.',
    action: 'Review escalation',
  },
  incident_approval: {
    label: 'Approval needed',
    message: 'A workflow step requires your approval. Review the request before deciding.',
    action: 'Review approval request',
  },
  incident_step_assigned: {
    label: 'Response step assigned',
    message: 'You have been assigned a response step. Open the ticket to review the work required.',
    action: 'Review assigned step',
  },
};

/** Email-to-ticket routing for ticket notifications, resolved by the dispatcher. */
export type NotificationEmailRouting = {
  ticketNumber?: number;
  replyTo?: string;
  workspaceName?: string;
};

export async function sendNotificationEmail(
  item: NotificationEmail,
  config: NotificationEmailConfiguration,
  request: typeof fetch = fetch,
  routing: NotificationEmailRouting = {},
): Promise<string> {
  const { base } = parseNotificationEmailConfiguration(config);
  const url = new URL(notificationHref(item), base.origin).href;
  const announcement = Boolean(item.service_announcement_id && item.approved_body);
  const incident = Boolean(
    (item.incident_bulletin_id || item.service_announcement_id) && item.approved_body,
  );
  const reason = item.email_kind ? emailReasons[item.email_kind] : undefined;
  const reply = Boolean(
    !incident &&
    item.ticket_id &&
    !item.conversation_id &&
    ['ticket_response', 'user_replied'].includes(item.email_kind ?? '') &&
    item.reply_preview,
  );
  const statusUpdate = Boolean(
    !incident &&
    item.ticket_id &&
    !item.conversation_id &&
    ['ticket_resolved', 'ticket_reopened'].includes(item.email_kind ?? '') &&
    item.ticket_status &&
    item.status_changed_by,
  );
  const statusLabel = item.ticket_status ? ticketStatuses[item.ticket_status].label : undefined;
  const label = statusUpdate
    ? item.ticket_status === 'closed'
      ? 'Ticket closed'
      : reason?.label
    : reply && item.reply_author
      ? `${item.reply_author} replied`
      : reason?.label;
  const action = reply ? 'Read reply and respond' : reason?.action;
  const details: { label: string; value: string }[] = [];
  if (
    !incident &&
    ['ticket_created', 'ticket_assigned', 'ticket_reassigned'].includes(item.email_kind ?? '') &&
    item.ticket_priority
  ) {
    details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  if (reply) {
    if (item.reply_author) details.push({ label: 'From', value: item.reply_author });
    if (item.reply_created_at)
      details.push({
        label: 'Replied at',
        value: `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(item.reply_created_at))} UTC`,
      });
    if (item.ticket_status)
      details.push({ label: 'Status at reply', value: ticketStatuses[item.ticket_status].label });
    if (item.ticket_priority)
      details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  if (statusUpdate) {
    if (item.previous_status)
      details.push({ label: 'Previous status', value: ticketStatuses[item.previous_status].label });
    details.push({ label: 'New status', value: statusLabel! });
    details.push({ label: 'Changed by', value: item.status_changed_by! });
    if (item.event_created_at)
      details.push({
        label: 'Changed at',
        value: `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(item.event_created_at))} UTC`,
      });
    if (item.ticket_owner) details.push({ label: 'Owner', value: item.ticket_owner });
    if (item.ticket_priority)
      details.push({ label: 'Priority', value: ticketPriorities[item.ticket_priority].label });
  }
  const reopenReason =
    !incident && item.email_kind === 'ticket_reopened' ? item.reopen_reason : null;
  const subject = reason && !incident ? `${label}: ${item.title}` : item.title;
  const message = incident
    ? item.approved_body!
    : statusUpdate
      ? `The ticket status changed${item.previous_status ? ` from ${ticketStatuses[item.previous_status].label}` : ''} to ${statusLabel}. ${item.email_kind === 'ticket_reopened' ? 'Further work is needed. Open the ticket to review the next steps.' : 'Review the outcome in FixxFlow. If the issue continues, return to the ticket to follow up.'}`
      : (reason?.message ?? 'There is an update waiting for you in FixxFlow.');
  // The queue prefixes public announcement bodies with a written status. Older
  // stakeholder updates remain plain messages and must not be reinterpreted.
  const publicStatus = announcement
    ? /^(?:Status: )(Investigating|Working on a fix|Monitoring|Resolved)\r?\n\r?\n/.exec(message)
    : null;
  const nextUpdate =
    incident && item.next_update_at
      ? ` Next update expected: ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(item.next_update_at))} UTC.`
      : '';
  // Replies route back to the ticket only when inbound email is configured.
  const emailReplies = Boolean(!incident && routing.replyTo && routing.ticketNumber);
  const note = announcement
    ? `Sent to all active workspace members.${nextUpdate}`
    : incident
      ? `You received this approved update as a selected stakeholder.${nextUpdate}`
      : emailReplies
        ? `You can reply to this email to add a message to ticket #${routing.ticketNumber}. Keep [#${routing.ticketNumber}] in the subject.`
        : reply
          ? 'Reply in FixxFlow to keep the conversation with the ticket. This email shows a short preview of the public reply.'
          : 'Sign in to your account to view the conversation.';
  const ticketTag = !incident && routing.ticketNumber ? ` [#${routing.ticketNumber}]` : '';
  const response = await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Reuse across queue leases and ambiguous failures; Resend retains keys for 24 hours.
      'Idempotency-Key': `notification/${item.notification_id}`,
    },
    body: JSON.stringify({
      from: config.from.trim(),
      to: [item.recipient_email],
      reply_to: emailReplies ? routing.replyTo : 'support@fixxflow.app',
      subject: `FixxFlow: ${subject}${ticketTag}`,
      text: incident
        ? `${item.title}\n\n${message}\n\n${note}\n\n${announcement ? 'View announcement' : 'View approved update'}:\n${url}`
        : reason
          ? `${label}\n${item.title}\n\n${message}${details.length ? `\n\n${details.map((detail) => `${detail.label}: ${detail.value}`).join('\n')}${reply ? `\n\nReply preview:\n${item.reply_preview}` : ''}` : ''}${reopenReason ? `\n\nReason for reopening:\n${reopenReason}` : ''}\n\n${action}:\n${url}\n\n${note}`
          : `${item.title}\n\nOpen FixxFlow to view this update:\n${url}\n\n${note}`,
      html: await renderEmail({
        title: reason && !incident ? label! : item.title,
        message:
          reason && !incident
            ? `${item.title}\n\n${message}`
            : publicStatus
              ? message.slice(publicStatus[0].length)
              : message,
        status: publicStatus?.[1],
        workspaceName: routing.workspaceName,
        action: incident
          ? announcement
            ? 'View announcement'
            : 'View approved update'
          : (action ?? 'View update'),
        href: url,
        note,
        preserveLines: incident || Boolean(reason),
        siteUrl: base.origin,
        notificationLabel: incident
          ? 'IT service update'
          : statusUpdate
            ? 'Ticket status update'
            : reply
              ? 'New public reply'
              : reason && !incident
                ? 'Workspace notification'
                : undefined,
        details,
        reopenReason: reopenReason ?? undefined,
        replyPreview: reply ? item.reply_preview! : undefined,
      }),
    }),
    signal: AbortSignal.timeout(8000),
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
