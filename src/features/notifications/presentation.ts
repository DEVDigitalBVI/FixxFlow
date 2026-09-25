import type { NotificationKind } from "@/types/database";

export const notificationLabels: Record<NotificationKind, string> = {
  ticket_assigned: "Assignment", ticket_response: "Response", new_chat: "New chat",
  ticket_reassigned: "Reassignment", sla_approaching: "SLA warning", ticket_resolved: "Resolved",
  ticket_reopened: "Reopened", user_replied: "Requester reply", chat_response: "Chat response",
};

export function notificationHref(item: { ticket_id: string | null; conversation_id: string | null }) {
  if (item.ticket_id) return `/app/tickets/${encodeURIComponent(item.ticket_id)}`;
  if (item.conversation_id) return `/app/chat/${encodeURIComponent(item.conversation_id)}`;
  return "/app/notifications";
}
