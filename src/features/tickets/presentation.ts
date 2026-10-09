import { TICKET_TIMEZONE } from "./deadlines";
import type { TicketPriority, TicketStatus } from "@/types/database";

export const ticketStatuses: Record<TicketStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "blue" }, open: { label: "Open", tone: "cyan" },
  in_progress: { label: "In progress", tone: "purple" }, waiting_on_user: { label: "Waiting on user", tone: "amber" },
  on_hold: { label: "On hold", tone: "slate" }, resolved: { label: "Resolved", tone: "green" },
  closed: { label: "Closed", tone: "slate" },
};

export const ticketPriorities: Record<TicketPriority, { label: string; tone: string }> = {
  low: { label: "Low", tone: "slate" }, normal: { label: "Normal", tone: "blue" },
  high: { label: "High", tone: "amber" }, critical: { label: "Critical", tone: "red" },
};

const ticketDateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: TICKET_TIMEZONE });

export const formatTicketDate = (value: string | null) => value
  ? ticketDateFormatter.format(new Date(value))
  : "Not set";

export const activityLabels: Record<string, string> = {
  inventory_approve: 'approved inventory and reserved stock', inventory_issue: 'recorded the inventory handover',
  inventory_decline: 'declined the inventory request', inventory_information: 'asked for more inventory information',
  inventory_cancel: 'cancelled the inventory request and released any reservation', inventory_cancelled: 'closed the ticket and cancelled unfinished inventory fulfillment',
  automatically_routed: "automatically routed this ticket to its category’s default team",
  created: "created the ticket", status_changed: "changed the status", assignment_changed: "changed the assignment",
  priority_changed: "changed the priority", details_updated: "updated ticket details", first_response_recorded: "sent the first response",
  reply_added: "added a reply", internal_note_added: "added an internal note",
};
