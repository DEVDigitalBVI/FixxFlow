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
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal") as TicketPriority;
  const requesterId = viewer.role === "end_user" ? viewer.id : optional(formData.get("requesterId")) ?? viewer.id;
  if (title.length < 3 || !description || !priorities.includes(priority)) fail("/app/tickets/new", "Add a title, description, and valid priority.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").insert({ organization_id: viewer.organizationId, requester_id: requesterId, title, description, priority, team_id: optional(formData.get("teamId")), category_id: optional(formData.get("categoryId")), subcategory_id: optional(formData.get("subcategoryId")), location_id: optional(formData.get("locationId")), assigned_technician_id: viewer.role === "end_user" ? null : optional(formData.get("assignedTechnicianId")), due_at: optional(formData.get("dueAt")) }).select("id").single();
  if (error || !data) fail("/app/tickets/new", "The ticket could not be created. Check the selected category and try again.");
  redirect(`/app/tickets/${data!.id}?success=Ticket created.`);
}

export async function updateTicket(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (viewer.role === "end_user") fail(`/app/tickets/${ticketId}`, "Only ticket workers can update ticket details.");
  const status = String(formData.get("status") ?? "") as TicketStatus;
  const priority = String(formData.get("priority") ?? "") as TicketPriority;
  if (!ticketId || !statuses.includes(status) || !priorities.includes(priority)) fail(`/app/tickets/${ticketId}`, "Choose a valid status and priority.");
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update({ status, priority, assigned_technician_id: optional(formData.get("assignedTechnicianId")), team_id: optional(formData.get("teamId")), category_id: optional(formData.get("categoryId")), subcategory_id: optional(formData.get("subcategoryId")), location_id: optional(formData.get("locationId")), due_at: optional(formData.get("dueAt")) }).eq("organization_id", viewer.organizationId).eq("id", ticketId);
  if (error) fail(`/app/tickets/${ticketId}`, "The ticket could not be updated.");
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
