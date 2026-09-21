"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type RoomMessage = { id: string; author_id: string; kind: "message" | "internal_note"; body: string; created_at: string };
export type RoomAttachment = { id: string; file_name: string; size_bytes: number; created_at: string; storage_path: string; url?: string };
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export function ChatRoom({ conversationId, organizationId, viewerId, isWorker, open, names, initialMessages, attachments }: {
  conversationId: string; organizationId: string; viewerId: string; isWorker: boolean; open: boolean;
  names: Record<string, string>; initialMessages: RoomMessage[]; attachments: RoomAttachment[];
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);
  const remoteTimer = useRef<number | null>(null);
  const lastTyping = useRef(0);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<"message" | "internal_note">("message");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase.from("chat_messages").select("id, author_id, kind, body, created_at").eq("organization_id", organizationId).eq("conversation_id", conversationId).order("created_at");
    if (!error && data) {
      setMessages(data);
      const thread = threadRef.current;
      if (thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight > 100) setNewMessages(true);
    }
  }, [supabase, organizationId, conversationId]);

  useEffect(() => {
    const channel = supabase.channel(`chat:${conversationId}`, { config: { private: true, presence: { key: `${viewerId}:${crypto.randomUUID()}` } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` }, () => { void loadMessages(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_conversations", filter: `id=eq.${conversationId}` }, () => router.refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_attachments", filter: `conversation_id=eq.${conversationId}` }, () => router.refresh())
      .on("presence", { event: "sync" }, () => {
        const others = Object.values(channel.presenceState()).flat().some(value => (value as { userId?: string }).userId !== viewerId);
        setOnline(others);
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.userId === viewerId) return;
        setTyping(Boolean(payload?.typing));
        if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
        if (payload?.typing) remoteTimer.current = window.setTimeout(() => setTyping(false), 3500);
      });
    channelRef.current = channel;
    void supabase.realtime.setAuth().then(() => channel.subscribe(status => {
      setConnected(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") void channel.track({ userId: viewerId });
    }));
    const fallback = window.setInterval(() => { if (document.visibilityState === "visible") { void loadMessages(); router.refresh(); } }, 15000);
    return () => {
      window.clearInterval(fallback);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, viewerId, supabase, loadMessages, router]);

  function announceTyping(value: string) {
    setDraft(value);
    if (!value.trim() || !connected) return;
    const now = Date.now();
    if (now - lastTyping.current > 1000) {
      lastTyping.current = now;
      void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: viewerId, typing: true } });
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: viewerId, typing: false } }); }, 1800);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || !open) return;
    setSending(true); setFeedback("");
    const { error } = await supabase.from("chat_messages").insert({ organization_id: organizationId, conversation_id: conversationId, author_id: viewerId, kind: isWorker ? kind : "message", body });
    if (error) setFeedback("Message not sent. Your draft is still here; try again.");
    else { setDraft(""); setTyping(false); await loadMessages(); }
    setSending(false);
  }

  async function upload(file: File | undefined) {
    if (!file || !open) return;
    if (!allowed.has(file.type) || file.size > 10 * 1024 * 1024) { setFeedback("Choose an image, PDF, text, Word, or Excel file under 10 MB."); return; }
    setUploading(true); setFeedback("");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${organizationId}/${conversationId}/${viewerId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("chat-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) setFeedback("Upload failed. Please try again.");
    else {
      const { error } = await supabase.from("chat_attachments").insert({ organization_id: organizationId, conversation_id: conversationId, uploaded_by: viewerId, storage_path: path, file_name: file.name, content_type: file.type, size_bytes: file.size });
      if (error) { await supabase.storage.from("chat-attachments").remove([path]); setFeedback("The attachment could not be saved. Please try again."); }
      else { setFeedback("Attachment added."); router.refresh(); }
    }
    setUploading(false);
  }

  return <section className="chat-room" aria-label="Conversation"><div className="chat-live-state"><span className={online ? "chat-online" : ""}>{online ? "Another participant online" : "Other participants offline"}</span><span>{connected ? "Live" : "Reconnecting…"}</span></div><div className="chat-thread" ref={threadRef} aria-live="polite" aria-relevant="additions text">{messages.map(message => <article key={message.id} className={`chat-message${message.author_id === viewerId ? " chat-message-own" : ""}${message.kind === "internal_note" ? " chat-message-note" : ""}`}><div className="chat-message-meta"><strong>{message.author_id === viewerId ? "You" : names[message.author_id] ?? "IT support"}{message.kind === "internal_note" ? " · Internal note" : ""}</strong><time dateTime={message.created_at}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.created_at))}</time></div><p>{message.body}</p></article>)}{!messages.length && <p className="muted">No messages yet.</p>}</div>{newMessages && <button className="chat-new-messages" type="button" onClick={() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); setNewMessages(false); }}>New messages ↓</button>}<div className="chat-typing" role="status">{typing ? "Someone is typing…" : "\u00a0"}</div>{attachments.length > 0 && <div className="chat-attachments"><h2>Files in this conversation</h2><ul>{attachments.map(file => <li key={file.id}>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.file_name}</a> : <span>{file.file_name}</span>}<small>{Math.ceil(file.size_bytes / 1024)} KB</small></li>)}</ul></div>}{open ? <form className="chat-composer" onSubmit={sendMessage}>{isWorker && <label htmlFor="chat-kind">Send as<select id="chat-kind" className="input" value={kind} onChange={event => setKind(event.target.value as "message" | "internal_note")}><option value="message">Reply to employee</option><option value="internal_note">Internal note · IT only</option></select></label>}<label htmlFor="chat-draft">{kind === "internal_note" && isWorker ? "Internal note · visible only to IT" : "Message"}</label><textarea id="chat-draft" className="input textarea" value={draft} onChange={event => announceTyping(event.target.value)} rows={3} maxLength={20000} placeholder="Write a message" required/><div className="chat-composer-actions"><label className="button button-secondary chat-file-button"><input type="file" disabled={uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }}/>{uploading ? "Uploading…" : "Add attachment"}</label><button className="button button-primary" disabled={sending}>{sending ? "Sending…" : kind === "internal_note" && isWorker ? "Add internal note" : "Send message"}</button></div></form> : <p className="chat-closed-note">This conversation is closed. Its history remains available here.</p>}{feedback && <p className="chat-feedback" role="status">{feedback}</p>}</section>;
}
