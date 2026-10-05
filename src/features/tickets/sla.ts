import type { TicketStatus } from "@/types/database";

export type SlaTicket = {
  created_at: string;
  status: TicketStatus;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  response_sla_due_at: string | null;
  resolution_sla_due_at: string | null;
};
export type SlaState = "on_track" | "warning" | "breached" | "met" | "missed" | "missing" | "unavailable";
export type SlaResult = { state: SlaState; label: string; deadline: string | null; completedAt: string | null };

function duration(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

export function evaluateSla(startedAt: string, deadline: string | null, completedAt: string | null, now: number, terminal = false): SlaResult {
  const due = deadline ? Date.parse(deadline) : NaN;
  if (!Number.isFinite(due)) return { state: "unavailable", label: "Not available", deadline: null, completedAt };
  if (completedAt) {
    const met = Date.parse(completedAt) <= due;
    return { state: met ? "met" : "missed", label: met ? "Met" : `Missed by ${duration(Date.parse(completedAt) - due)}`, deadline, completedAt };
  }
  if (terminal) return { state: "missing", label: "No public response recorded", deadline, completedAt };
  const remaining = due - now;
  if (remaining <= 0) return { state: "breached", label: remaining === 0 ? "Breached · due now" : `Breached ${duration(-remaining)} ago`, deadline, completedAt };
  const warningWindow = Math.min(30 * 60000, Math.max(0, (due - Date.parse(startedAt)) * 0.2));
  return { state: remaining <= warningWindow ? "warning" : "on_track", label: `Due in ${duration(remaining)}`, deadline, completedAt };
}

export function ticketSla(ticket: SlaTicket, now: number) {
  const terminal = ticket.status === "resolved" || ticket.status === "closed";
  return {
    response: evaluateSla(ticket.created_at, ticket.response_sla_due_at, ticket.first_response_at, now, terminal),
    resolution: terminal && !ticket.resolved_at && !ticket.closed_at
      ? { state: "unavailable" as const, label: "Completion time unavailable", deadline: ticket.resolution_sla_due_at, completedAt: null }
      : evaluateSla(ticket.created_at, ticket.resolution_sla_due_at, terminal ? ticket.resolved_at ?? ticket.closed_at : null, now),
  };
}
