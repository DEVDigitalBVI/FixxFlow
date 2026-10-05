import { profileLabels } from "@/features/lookups/labels";
import { HISTORY_PAGE_SIZE, recentMessages } from "@/features/conversations/history";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTicketDate } from "@/features/tickets/presentation";

export async function LinkedChatHistory({ ticketId, organizationId, viewerId }: { ticketId: string; organizationId: string; viewerId: string }) {
  const supabase = await createClient();
  const { data: chat, error: chatError } = await supabase.from("chat_conversations").select("id, topic, requester_id").eq("organization_id", organizationId).eq("ticket_id", ticketId).maybeSingle();
  if (chatError) return <p role="alert">Linked chat could not load. Refresh to retry.</p>;
  if (!chat) return null;
  const [messagesR, attachmentsR] = await Promise.all([
    supabase.from("chat_messages").select("id, author_id, kind, body, created_at").eq("organization_id", organizationId).eq("conversation_id", chat.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_PAGE_SIZE),
    supabase.from("chat_attachments").select("id, file_name, storage_path, size_bytes").eq("organization_id", organizationId).eq("conversation_id", chat.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_PAGE_SIZE),
  ]);
  const profiles = await profileLabels(supabase, organizationId, (messagesR.data ?? []).map(row => row.author_id));
  const names = new Map(profiles.map(profile => [profile.user_id, profile.display_name]));
  const paths = (attachmentsR.data ?? []).map(file => file.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("chat-attachments").createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map((signed ?? []).map(file => [file.path, file.signedUrl ?? undefined]));
  return <section className="settings-card linked-chat-history"><div className="linked-chat-heading"><div><h2>Chat history</h2><p>Recent conversation from “{chat.topic}”</p></div><Link href={`/app/chat/${chat.id}`}>Open chat</Link></div><Link href={`/app/chat/${chat.id}/history`} target="_blank" rel="noopener noreferrer">Browse full history (opens in a new tab)</Link>{(messagesR.error || attachmentsR.error) && <p role="alert">Some history could not load. Refresh to retry.</p>}<div className="conversation">{recentMessages(messagesR.data ?? []).map(message => <article key={message.id} className={`message${message.kind === "internal_note" ? " message-note" : ""}`}><header><strong>{message.author_id === viewerId ? "You" : names.get(message.author_id) ?? "IT support"}{message.kind === "internal_note" ? " · Internal note" : ""}</strong><time dateTime={message.created_at}>{formatTicketDate(message.created_at)}</time></header><p>{message.body}</p></article>)}</div>{attachmentsR.data && attachmentsR.data.length > 0 && <div className="attachment-list"><h3>Chat attachments</h3>{attachmentsR.data.map(file => urls.get(file.storage_path) ? <a key={file.id} href={urls.get(file.storage_path)} target="_blank" rel="noreferrer">{file.file_name} · {Math.ceil(file.size_bytes / 1024)} KB</a> : <span key={file.id}>{file.file_name} · Link unavailable</span>)}</div>}</section>;
}
