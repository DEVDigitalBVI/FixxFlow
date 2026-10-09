"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { reportServerError } from "@/lib/server-errors";

const chatPath = (id: string) => `/app/chat/${id}`;
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const fail = (path: string, message: string): never => redirect(`${path}?${new URLSearchParams({ error: message })}`);

export type StartChatState = { error?: string; fields?: { topic?: string; message?: string } };

export async function startChat(_previous: StartChatState, formData: FormData): Promise<StartChatState> {
  const viewer = await requireViewer();
  const topic = String(formData.get("topic") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const fields: StartChatState['fields'] = {};
  if (topic.length < 3 || topic.length > 180) fields.topic = "Enter a subject between 3 and 180 characters.";
  if (!message || message.length > 20000) fields.message = "Enter a message of up to 20,000 characters.";
  if (Object.keys(fields).length) return { error: "Check the highlighted fields before starting your chat.", fields };
  const submissionKey = String(formData.get("submissionKey") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionKey)) return { error: "Reload the chat form before submitting. Your message is still here." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_support_request", { org: viewer.organizationId, token: submissionKey, kind: "chat", payload: { topic, message } });
  if (error?.code === "PT409") return { error: "This chat was already started with different details. Check your chats before starting another." };
  if (error || !data) return { error: "Chat could not be started. Your message is still here. Please try again." };
  revalidatePath("/app/chat");
  redirect(chatPath(data!));
}

export async function assignChat(formData: FormData) {
  if (formData.has("lookupLoadError") || !formData.has("assigneeId")) return { error: "Choices could not load. Retry the lookup before saving; your selection is preserved." };
  const viewer = await requireViewer();
  if (viewer.role === "end_user") return { error: "Only IT can assign chats." };
  const id = String(formData.get("conversationId") ?? "");
  const assignee = String(formData.get("assigneeId") ?? "");
  if (!validId(id)) return { error: "Choose a valid chat." };
  const supabase = await createClient();
  if (assignee) {
    const { data: worker, error } = await supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("user_id", assignee).eq("status", "active").in("role", ["technician", "administrator"]).maybeSingle();
    if (error) { reportServerError('chat.assign', error); return { error: "Technicians could not be verified. Your selection is preserved. Please try again." }; }
    if (!worker) return { error: "Choose an active technician." };
  }
  const { data, error } = await supabase.from("chat_conversations").update({ assigned_technician_id: assignee || null }).eq("organization_id", viewer.organizationId).eq("id", id).select("id").maybeSingle();
  if (error || !data) { reportServerError('chat.assign', error); return { error: "The chat could not be assigned. Your selection is preserved. Please try again." }; }
  revalidatePath("/app/chat"); revalidatePath(chatPath(id));
  return { success: "Assignment saved." };
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
