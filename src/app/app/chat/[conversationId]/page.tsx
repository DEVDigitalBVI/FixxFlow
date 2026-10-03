import { ActionForm } from "@/components/ui/action-form";
import { LookupSelect } from "@/features/lookups/lookup-select";
import { profileLabels } from "@/features/lookups/labels";
import { HISTORY_PAGE_SIZE, recentMessages } from "@/features/conversations/history";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { ChatRoom } from "@/features/chat/chat-room";
import { assignChat, closeChat, convertChatToTicket, linkChatToTicket } from "../actions";

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ conversationId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const viewer = await requireViewer();
  const { conversationId } = await params;
  const notice = await searchParams;
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase.from("chat_conversations").select("*").eq("organization_id", viewer.organizationId).eq("id", conversationId).maybeSingle();
  if (conversationError) throw new Error("Conversation could not be loaded. Please try again.");
  if (!conversation || (viewer.role === "end_user" && conversation.requester_id !== viewer.id)) notFound();
  const worker = viewer.role !== "end_user";
  const [messagesR, attachmentsR, ticketsR] = await Promise.all([
    supabase.from("chat_messages").select("id, author_id, kind, body, created_at").eq("organization_id", viewer.organizationId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_PAGE_SIZE),
    supabase.from("chat_attachments").select("id, file_name, size_bytes, created_at, storage_path").eq("organization_id", viewer.organizationId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_PAGE_SIZE),
    worker && !conversation.ticket_id ? supabase.from("tickets").select("id, ticket_number, title").eq("organization_id", viewer.organizationId).eq("requester_id", conversation.requester_id).order("updated_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
  ]);
  const profiles = await profileLabels(supabase, viewer.organizationId, [conversation.requester_id, conversation.assigned_technician_id, ...(messagesR.data ?? []).map(row => row.author_id)]);
  const names = Object.fromEntries(profiles.map(profile => [profile.user_id, profile.display_name]));
  const paths = (attachmentsR.data ?? []).map(file => file.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("chat-attachments").createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map((signed ?? []).map(file => [file.path, file.signedUrl ?? undefined]));
  const attachments = (attachmentsR.data ?? []).map(file => ({ ...file, url: urls.get(file.storage_path) }));
  return <div className={worker ? "page chat-detail-page" : "portal-page chat-detail-page"}><header className="chat-detail-header"><div><Link className="button button-quiet page-back-link" href="/app/chat">← {worker ? "Live support" : "My chats"}</Link><p className="page-eyebrow">Support conversation</p><h1>{conversation.topic}</h1><p>With {worker ? names[conversation.requester_id] ?? "Employee" : "IT support"} · <strong>{conversation.status === "open" ? "Open" : "Closed"}</strong></p></div>{conversation.ticket_id && <Link className="button button-secondary" href={`/app/tickets/${conversation.ticket_id}`}>View linked ticket</Link>}</header>{notice.error && <div className="alert alert-error page-alert" role="alert">{notice.error}</div>}{notice.success && <div className="alert alert-success page-alert" role="status">{notice.success}</div>}{messagesR.error && <div className="alert alert-error page-alert" role="alert">Messages could not be loaded. Refresh to try again.</div>}
    <div className="chat-detail-layout"><ChatRoom key={conversation.id} conversationId={conversation.id} organizationId={viewer.organizationId} viewerId={viewer.id} isWorker={worker} open={conversation.status === "open"} names={names} initialMessages={recentMessages(messagesR.data ?? [])} attachments={attachments}/>{worker && <aside className="chat-controls"><section className="settings-card"><h2>Conversation tools</h2><ActionForm action={assignChat} className="chat-control-form"><input type="hidden" name="conversationId" value={conversation.id}/><LookupSelect resource="technicians" name="assigneeId" label="Assigned technician" defaultValue={conversation.assigned_technician_id ?? ""}/><SubmitButton className="button button-secondary">Save assignment</SubmitButton></ActionForm>{!conversation.ticket_id ? <><form action={convertChatToTicket} className="chat-control-form"><input type="hidden" name="conversationId" value={conversation.id}/><SubmitButton className="button button-primary">Create ticket from chat</SubmitButton></form>{ticketsR.data && ticketsR.data.length > 0 && <form action={linkChatToTicket} className="chat-control-form"><input type="hidden" name="conversationId" value={conversation.id}/><label htmlFor="chat-ticket">Link to an existing ticket</label><select id="chat-ticket" className="input" name="ticketId" required defaultValue=""><option value="">Choose a ticket</option>{ticketsR.data.map(ticket => <option key={ticket.id} value={ticket.id}>#{ticket.ticket_number} · {ticket.title}</option>)}</select><SubmitButton className="button button-secondary">Link ticket</SubmitButton></form>}</> : <p className="muted">The full chat history is attached to its linked ticket.</p>}{conversation.status === "open" && <form action={closeChat} className="chat-control-form"><input type="hidden" name="conversationId" value={conversation.id}/><SubmitButton className="button button-secondary">Close conversation</SubmitButton></form>}</section></aside>}</div></div>;
}
