import type { NotificationKind } from '@/types/database';

export const notificationLabels: Record<NotificationKind, string> = {
  asset_lifecycle: 'Equipment lifecycle',
  inventory_low_stock: 'Low stock',
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
  chat_idle_warning: 'Chat reply reminder',
  chat_auto_closed: 'Chat closed',
};

export function notificationHref(item: {
  asset_id?: string | null;
  inventory_item_id?: string | null;
  email_kind?: string | null;
  ticket_id: string | null;
  conversation_id: string | null;
  incident_bulletin_id?: string | null;
  service_announcement_id?: string | null;
}) {
  if (item.asset_id) return `/app/assets/${encodeURIComponent(item.asset_id)}`;
  if (item.inventory_item_id) return `/app/inventory/${encodeURIComponent(item.inventory_item_id)}`;
  if (item.email_kind === 'asset_lifecycle') return '/app/assets';
  if (item.email_kind === 'inventory_low_stock') return '/app/inventory';
  if (item.service_announcement_id)
    return `/app/service-status#notice-${encodeURIComponent(item.service_announcement_id)}`;
  if (item.incident_bulletin_id)
    return `/app/incident-updates/${encodeURIComponent(item.incident_bulletin_id)}`;
  if (item.conversation_id) return `/app/chat/${encodeURIComponent(item.conversation_id)}`;
  if (item.ticket_id) return `/app/tickets/${encodeURIComponent(item.ticket_id)}`;
  return '/app/notifications';
}
