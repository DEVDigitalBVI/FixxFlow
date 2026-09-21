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

export const formatTicketDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Not set";

export const activityLabels: Record<string, string> = {
  created: "created the ticket", status_changed: "changed the status", assignment_changed: "changed the assignment",
  priority_changed: "changed the priority", details_updated: "updated ticket details", first_response_recorded: "sent the first response",
  reply_added: "added a reply", internal_note_added: "added an internal note",
};
