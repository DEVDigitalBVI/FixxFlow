"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import type { TicketMessageKind, TicketPriority, TicketStatus } from "@/types/database";

const statuses: TicketStatus[] = ["new", "open", "in_progress", "waiting_on_user", "on_hold", "resolved", "closed"];
const priorities: TicketPriority[] = ["low", "normal", "high", "critical"];
const optional = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;
const fail = (path: string, message: string): never => redirect(`${path}?${new URLSearchParams({ error: message })}`);

export async function createTicket(formData: FormData) {
  const viewer = await requireViewer();
  const chat = viewer.role === "end_user" && formData.get("source") === "chat";
  const formPath = chat ? "/app/chat" : "/app/tickets/new";
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal") as TicketPriority;
  const requesterId = viewer.role === "end_user" ? viewer.id : optional(formData.get("requesterId")) ?? viewer.id;
  if (title.length < 3 || !description || !priorities.includes(priority)) fail(formPath, "Add a subject and message.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").insert({ organization_id: viewer.organizationId, requester_id: requesterId, title, description, priority, team_id: optional(formData.get("teamId")), category_id: optional(formData.get("categoryId")), subcategory_id: optional(formData.get("subcategoryId")), location_id: optional(formData.get("locationId")), assigned_technician_id: viewer.role === "end_user" ? null : optional(formData.get("assignedTechnicianId")), due_at: optional(formData.get("dueAt")) }).select("id").single();
  if (error || !data) fail(formPath, "Your message could not be sent. Please try again.");
  redirect(`/app/tickets/${data!.id}?success=${chat ? "Conversation started." : "Request sent."}`);
}

export async function updateTicket(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (viewer.role === "end_user") fail(`/app/tickets/${ticketId}`, "Only ticket workers can update ticket details.");
  const status = String(formData.get("status") ?? "") as TicketStatus;
  const priority = String(formData.get("priority") ?? "") as TicketPriority;
  if (!ticketId || !statuses.includes(status) || !priorities.includes(priority)) fail(`/app/tickets/${ticketId}`, "Choose a valid status and priority.");
  const supabase = await createClient();
  const assignee = optional(formData.get("assignedTechnicianId"));
  if (assignee) {
    const { data: worker } = await supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("user_id", assignee).eq("status", "active").in("role", ["technician", "administrator"]).maybeSingle();
    if (!worker) fail(`/app/tickets/${ticketId}`, "Choose an active technician.");
  }
  const { data, error } = await supabase.from("tickets").update({ status, priority, assigned_technician_id: assignee, team_id: optional(formData.get("teamId")), category_id: optional(formData.get("categoryId")), subcategory_id: optional(formData.get("subcategoryId")), location_id: optional(formData.get("locationId")), due_at: optional(formData.get("dueAt")) }).eq("organization_id", viewer.organizationId).eq("id", ticketId).select("id").maybeSingle();
  if (error || !data) fail(`/app/tickets/${ticketId}`, "The ticket could not be updated.");
  revalidatePath(`/app/tickets/${ticketId}`); revalidatePath("/app/tickets");
  redirect(`/app/tickets/${ticketId}?success=Ticket updated.`);
}

export async function addTicketMessage(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "reply") as TicketMessageKind;
  if (!ticketId || !body || !["reply", "internal_note"].includes(kind) || (kind === "internal_note" && viewer.role === "end_user")) fail(`/app/tickets/${ticketId}`, "Enter a message you are permitted to send.");
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_messages").insert({ organization_id: viewer.organizationId, ticket_id: ticketId, author_id: viewer.id, body, kind });
  if (error) fail(`/app/tickets/${ticketId}`, "The message could not be added.");
  revalidatePath(`/app/tickets/${ticketId}`); revalidatePath("/app/tickets");
  redirect(`/app/tickets/${ticketId}?success=${kind === "internal_note" ? "Internal note added." : "Reply sent."}`);
}

export async function reopenTicket(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  const path = `/app/tickets/${ticketId}`;
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) fail("/app/tickets", "Choose a valid request.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").update({ status: "open" }).eq("organization_id", viewer.organizationId).eq("id", ticketId).eq("requester_id", viewer.id).in("status", ["resolved", "closed"]).select("id").maybeSingle();
  if (error || !data) fail(path, "This request could not be reopened. Refresh and try again.");
  revalidatePath(path); revalidatePath("/app/tickets"); revalidatePath("/app");
  redirect(`${path}?success=Request reopened.`);
}

export async function bulkUpdateTickets(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") fail("/app/tickets", "You cannot update these tickets.");
  const ids = [...new Set(formData.getAll("ticketIds").map(String))];
  const intent = String(formData.get("intent") ?? "");
  const value = String(formData.get(intent) ?? "");
  if (!ids.length || ids.length > 100 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) fail("/app/tickets", "Select up to 100 tickets.");
  const supabase = await createClient();
  let changes: { status?: TicketStatus; priority?: TicketPriority; assigned_technician_id?: string | null } = {};
  if (intent === "status" && statuses.includes(value as TicketStatus)) changes = { status: value as TicketStatus };
  else if (intent === "priority" && priorities.includes(value as TicketPriority)) changes = { priority: value as TicketPriority };
  else if (intent === "assignee") {
    if (value) {
      const { data: worker } = await supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("user_id", value).eq("status", "active").in("role", ["technician", "administrator"]).maybeSingle();
      if (!worker) fail("/app/tickets", "Choose an active technician.");
    }
    changes = { assigned_technician_id: value || null };
  } else fail("/app/tickets", "Choose a valid bulk action.");
  const { data, error } = await supabase.from("tickets").update(changes).eq("organization_id", viewer.organizationId).in("id", ids).select("id");
  if (error || !data || data.length !== ids.length) fail("/app/tickets", "Some tickets could not be updated. Refresh the queue and try again.");
  const count = data?.length ?? 0;
  revalidatePath("/app/tickets"); revalidatePath("/app");
  redirect(`/app/tickets?success=${encodeURIComponent(`${count} ticket${count === 1 ? "" : "s"} updated.`)}`);
}
