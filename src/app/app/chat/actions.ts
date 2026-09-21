"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const chatPath = (id: string) => `/app/chat/${id}`;
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const fail = (path: string, message: string): never => redirect(`${path}?${new URLSearchParams({ error: message })}`);

export async function startChat(formData: FormData) {
  const viewer = await requireViewer();
  const topic = String(formData.get("topic") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (topic.length < 3 || topic.length > 180 || !message || message.length > 20000) fail("/app/chat", "Add a subject and a message to start the chat.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_support_chat", { target_organization_id: viewer.organizationId, chat_topic: topic, first_message: message });
  if (error || !data) fail("/app/chat", "Chat could not be started. Please try again.");
  revalidatePath("/app/chat");
  redirect(chatPath(data!));
}

export async function assignChat(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") fail("/app/chat", "Only IT can assign chats.");
  const id = String(formData.get("conversationId") ?? "");
  const assignee = String(formData.get("assigneeId") ?? "");
  if (!validId(id)) fail("/app/chat", "Choose a valid chat.");
  const supabase = await createClient();
  if (assignee) {
    const { data: worker } = await supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("user_id", assignee).eq("status", "active").in("role", ["technician", "administrator"]).maybeSingle();
    if (!worker) fail(chatPath(id), "Choose an active technician.");
  }
  const { data, error } = await supabase.from("chat_conversations").update({ assigned_technician_id: assignee || null }).eq("organization_id", viewer.organizationId).eq("id", id).select("id").maybeSingle();
  if (error || !data) fail(chatPath(id), "The chat could not be assigned.");
  revalidatePath("/app/chat"); revalidatePath(chatPath(id));
  redirect(`${chatPath(id)}?success=Assignment updated.`);
}

export async function closeChat(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") fail("/app/chat", "Only IT can close chats.");
  const id = String(formData.get("conversationId") ?? "");
  if (!validId(id)) fail("/app/chat", "Choose a valid chat.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("chat_conversations").update({ status: "closed" }).eq("organization_id", viewer.organizationId).eq("id", id).eq("status", "open").select("id").maybeSingle();
  if (error || !data) fail(chatPath(id), "The chat could not be closed.");
  revalidatePath("/app/chat"); revalidatePath(chatPath(id));
  redirect(`${chatPath(id)}?success=Conversation closed.`);
}

export async function convertChatToTicket(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") fail("/app/chat", "Only IT can create tickets from chat.");
  const id = String(formData.get("conversationId") ?? "");
  if (!validId(id)) fail("/app/chat", "Choose a valid chat.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_chat_to_ticket", { conversation_id: id });
  if (error || !data) fail(chatPath(id), "The chat could not be converted. Please try again.");
  revalidatePath("/app/chat"); revalidatePath(chatPath(id)); revalidatePath("/app/tickets");
  redirect(`/app/tickets/${data}?success=Ticket created from chat.`);
}

export async function linkChatToTicket(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") fail("/app/chat", "Only IT can link chats to tickets.");
  const id = String(formData.get("conversationId") ?? "");
  const ticketId = String(formData.get("ticketId") ?? "");
  if (!validId(id) || !validId(ticketId)) fail(chatPath(id), "Choose a valid ticket.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_chat_to_ticket", { conversation_id: id, target_ticket_id: ticketId });
  if (error || !data) fail(chatPath(id), "The chat could not be linked. Choose a ticket from the same requester.");
  revalidatePath(chatPath(id)); revalidatePath(`/app/tickets/${data}`);
  redirect(`${chatPath(id)}?success=Linked to ticket.`);
}
