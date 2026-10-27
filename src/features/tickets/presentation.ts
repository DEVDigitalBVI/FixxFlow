import type { NavigationIconName } from '@/components/navigation/navigation-icon';
import { formatTimestamp } from '@/features/timezones/model';
import type { TicketPriority, TicketStatus } from '@/types/database';

type BadgePresentation = {
  label: string;
  tone: 'neutral' | 'active' | 'warning' | 'success' | 'danger';
  icon: NavigationIconName;
};
export const ticketStatuses: Record<TicketStatus, BadgePresentation> = {
  new: { label: 'New', tone: 'neutral', icon: 'inbox' },
  open: { label: 'Open', tone: 'active', icon: 'open' },
  in_progress: { label: 'In progress', tone: 'active', icon: 'progress' },
  waiting_on_user: { label: 'Waiting on user', tone: 'warning', icon: 'clock' },
  on_hold: { label: 'On hold', tone: 'neutral', icon: 'pause' },
  resolved: { label: 'Resolved', tone: 'success', icon: 'check' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'lock' },
};
export const ticketPriorities: Record<TicketPriority, BadgePresentation> = {
  low: { label: 'Low', tone: 'neutral', icon: 'priorityLow' },
  normal: { label: 'Normal', tone: 'neutral', icon: 'priorityNormal' },
  high: { label: 'High', tone: 'warning', icon: 'priorityHigh' },
  critical: { label: 'Urgent', tone: 'danger', icon: 'alert' },
};

export const formatTicketDate = (value: string | null, timeZone = 'UTC') =>
  formatTimestamp(value, timeZone);

export const activityLabels: Record<string, string> = {
  inventory_approve: 'approved inventory and reserved stock',
  inventory_issue: 'recorded the inventory handover',
  inventory_decline: 'declined the inventory request',
  inventory_information: 'asked for more inventory information',
  inventory_cancel: 'cancelled the inventory request and released any reservation',
  inventory_cancelled: 'closed the ticket and cancelled unfinished inventory fulfillment',
  automatically_routed: 'automatically routed this ticket to its category’s default team',
  created: 'created the ticket',
  status_changed: 'changed the status',
  assignment_changed: 'changed the assignment',
  incident_declared: 'declared an incident',
  incident_updated: 'updated incident coordination',
  priority_changed: 'changed the priority',
  details_updated: 'updated ticket details',
  first_response_recorded: 'sent the first response',
  reply_added: 'added a reply',
  internal_note_added: 'added an internal note',
};
