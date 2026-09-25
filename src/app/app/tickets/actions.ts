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

type Classification = { categoryId: string | null; subcategoryId: string | null };

async function classificationError(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string, selection: Classification, previous?: Classification) {
  const { categoryId, subcategoryId } = selection;
  if (!categoryId) return subcategoryId ? "Choose a category before selecting a subcategory." : null;
  const { data: category, error } = await supabase.from("ticket_categories").select("id, is_active").eq("organization_id", organizationId).eq("id", categoryId).maybeSingle();
  if (error || !category || (!category.is_active && categoryId !== previous?.categoryId)) return "Choose an available category.";
  if (subcategoryId) {
    const { data: subcategory, error: subcategoryError } = await supabase.from("ticket_subcategories").select("id, is_active").eq("organization_id", organizationId).eq("category_id", categoryId).eq("id", subcategoryId).maybeSingle();
    if (subcategoryError || !subcategory || (!subcategory.is_active && subcategoryId !== previous?.subcategoryId)) return "Choose an available subcategory belonging to this category.";
  }
  return null;
}

export async function createTicket(formData: FormData) {
  const viewer = await requireViewer();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal") as TicketPriority;
  const requesterId = viewer.role === "end_user" ? viewer.id : optional(formData.get("requesterId")) ?? viewer.id;
  if (title.length < 3 || !description || !priorities.includes(priority)) fail("/app/tickets/new", "Add a subject and description.");
  const supabase = await createClient();
  if (formData.has("categoryLoadError")) fail("/app/tickets/new", "Categories could not be loaded. Refresh the page and try again.");
  const classification = { categoryId: optional(formData.get("categoryId")), subcategoryId: viewer.role === "end_user" ? null : optional(formData.get("subcategoryId")) };
  const categoryError = await classificationError(supabase, viewer.organizationId, classification);
  if (categoryError) fail("/app/tickets/new", categoryError);
  const { data, error } = await supabase.from("tickets").insert({ organization_id: viewer.organizationId, requester_id: requesterId, title, description, priority, team_id: optional(formData.get("teamId")), category_id: classification.categoryId, subcategory_id: classification.subcategoryId, location_id: optional(formData.get("locationId")), assigned_technician_id: viewer.role === "end_user" ? null : optional(formData.get("assignedTechnicianId")), due_at: optional(formData.get("dueAt")) }).select("id").single();
  if (error || !data) fail("/app/tickets/new", "Your request could not be sent. Please try again.");
  redirect(`/app/tickets/${data!.id}?success=Request sent.`);
}

export async function updateTicket(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (viewer.role === "end_user") fail(`/app/tickets/${ticketId}`, "Only ticket workers can update ticket details.");
  const status = String(formData.get("status") ?? "") as TicketStatus;
  const priority = String(formData.get("priority") ?? "") as TicketPriority;
  if (!ticketId || !statuses.includes(status) || !priorities.includes(priority)) fail(`/app/tickets/${ticketId}`, "Choose a valid status and priority.");
  const supabase = await createClient();
  if (formData.has("categoryLoadError") || !formData.has("categoryId") || !formData.has("subcategoryId")) fail(`/app/tickets/${ticketId}`, "Categories could not be loaded. Refresh the page and try again.");
  const { data: currentTicket } = await supabase.from("tickets").select("category_id, subcategory_id").eq("organization_id", viewer.organizationId).eq("id", ticketId).maybeSingle();
  if (!currentTicket) fail(`/app/tickets/${ticketId}`, "The ticket could not be loaded. Refresh and try again.");
  const classification = { categoryId: optional(formData.get("categoryId")), subcategoryId: optional(formData.get("subcategoryId")) };
  const categoryError = await classificationError(supabase, viewer.organizationId, classification, { categoryId: currentTicket!.category_id, subcategoryId: currentTicket!.subcategory_id });
  if (categoryError) fail(`/app/tickets/${ticketId}`, categoryError);
  const assignee = optional(formData.get("assignedTechnicianId"));
  if (assignee) {
    const { data: worker } = await supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("user_id", assignee).eq("status", "active").in("role", ["technician", "administrator"]).maybeSingle();
    if (!worker) fail(`/app/tickets/${ticketId}`, "Choose an active technician.");
  }
  const { data, error } = await supabase.from("tickets").update({ status, priority, assigned_technician_id: assignee, team_id: optional(formData.get("teamId")), category_id: classification.categoryId, subcategory_id: classification.subcategoryId, location_id: optional(formData.get("locationId")), due_at: optional(formData.get("dueAt")) }).eq("organization_id", viewer.organizationId).eq("id", ticketId).select("id").maybeSingle();
  if (error || !data) fail(`/app/tickets/${ticketId}`, "The ticket could not be updated.");
  revalidatePath(`/app/tickets/${ticketId}`); revalidatePath("/app/tickets");
  redirect(`/app/tickets/${ticketId}?success=Ticket updated.`);
}

export async function addTicketMessage(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "reply") as TicketMessageKind;
  const messageId = String(formData.get("messageId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ticketId) || !/^[0-9a-f-]{36}$/i.test(messageId) || !body || body.length > 20000 || !["reply", "internal_note"].includes(kind) || (kind === "internal_note" && viewer.role === "end_user")) return { error: "Enter a message you are permitted to send (up to 20,000 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_messages").insert({ id: messageId, organization_id: viewer.organizationId, ticket_id: ticketId, author_id: viewer.id, body, kind });
  if (error) {
    // A retry after a lost response must not post the same message twice.
    const { data: existing } = await supabase.from("ticket_messages").select("id, body, kind, author_id, ticket_id").eq("id", messageId).eq("organization_id", viewer.organizationId).maybeSingle();
    if (!existing || existing.body !== body || existing.kind !== kind || existing.author_id !== viewer.id || existing.ticket_id !== ticketId) return { error: "The message could not be added. Your draft is preserved; please try again." };
  }
  revalidatePath(`/app/tickets/${ticketId}`); revalidatePath("/app/tickets");
  return { success: kind === "internal_note" ? "Internal note added · IT staff only." : "Public reply sent." };
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
