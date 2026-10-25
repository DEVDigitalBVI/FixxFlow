import type { NotificationKind } from '@/types/database';

export const notificationLabels: Record<NotificationKind, string> = {
  incident_escalation: 'Workflow escalation',
  incident_approval: 'Approval',
  incident_step_assigned: 'Response step assignment',
  incident_update: 'IT update',
  incident_update_due: 'Stakeholder update due',
  automation_update: 'Automation update',
  ticket_created: 'New ticket',
  ticket_assigned: 'Assignment',
  ticket_response: 'Response',
  new_chat: 'New chat',
  ticket_reassigned: 'Reassignment',
  sla_approaching: 'SLA warning',
  ticket_resolved: 'Resolved',
  ticket_reopened: 'Reopened',
  user_replied: 'Requester reply',
  chat_response: 'Chat response',
};

export function notificationHref(item: {
  ticket_id: string | null;
  conversation_id: string | null;
  incident_bulletin_id?: string | null;
}) {
  if (item.incident_bulletin_id)
    return `/app/incident-updates/${encodeURIComponent(item.incident_bulletin_id)}`;
  if (item.conversation_id) return `/app/chat/${encodeURIComponent(item.conversation_id)}`;
  if (item.ticket_id) return `/app/tickets/${encodeURIComponent(item.ticket_id)}`;
  return '/app/notifications';
}
