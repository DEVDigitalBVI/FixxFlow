"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouteRefresh } from "@/lib/realtime/use-route-refresh";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { formatTicketDate } from "@/features/tickets/presentation";
import { attachmentTypes, uploadAndRegister, validAttachment } from "@/lib/uploads";
import { createClient } from "@/lib/supabase/client";

export type RoomMessage = { id: string; author_id: string; kind: "message" | "internal_note"; body: string; created_at: string };
export type RoomAttachment = { id: string; file_name: string; size_bytes: number; created_at: string; storage_path: string; url?: string };


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
  const messages = initialMessages;
  const [drafts, setDrafts] = useState({ message: "", internal_note: "" });
  const [kind, setKind] = useState<"message" | "internal_note">(isWorker ? "internal_note" : "message");
  const draft = drafts[kind];
  const pendingMessage = useRef<{ id: string; body: string; kind: typeof kind } | null>(null);
  const sendInFlight = useRef(false);
  const uploadInFlight = useRef(false);

  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [seenMessageId, setSeenMessageId] = useState(initialMessages.at(-1)?.id);
  const newMessages = messages.length > 0 && messages.at(-1)?.id !== seenMessageId;
  const refresh = useRouteRefresh(connected ? 60000 : 15000);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const channel = supabase.channel(`chat:${conversationId}`, { config: { private: true, presence: { key: `${viewerId}:${crypto.randomUUID()}` } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_conversations", filter: `id=eq.${conversationId}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_attachments", filter: `conversation_id=eq.${conversationId}` }, refresh)
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
    void supabase.realtime.setAuth().then(() => {
      if (disposed) return;
      channel.subscribe(status => {
        if (disposed) return;
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") { void channel.track({ userId: viewerId }); refresh(); }
      });
    }).catch(() => { if (!disposed) setConnected(false); });
    return () => {
      disposed = true;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, viewerId, supabase, refresh]);

  function announceTyping(value: string) {
    setDrafts(current => ({ ...current, [kind]: value }));
    if (kind === "internal_note" || !value.trim() || !connected) return;
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
    if (!body || sendInFlight.current || !open) return;
    sendInFlight.current = true;
    const audience = isWorker ? kind : "message";
    if (!pendingMessage.current || pendingMessage.current.body !== body || pendingMessage.current.kind !== audience) {
      pendingMessage.current = { id: crypto.randomUUID(), body, kind: audience };
    }
    const pending = pendingMessage.current;
    setSending(true); setFeedback("");
    try {
      const { error } = await supabase.from("chat_messages").insert({ id: pending.id, organization_id: organizationId, conversation_id: conversationId, author_id: viewerId, kind: audience, body });
      if (error) {
        const { data: existing } = await supabase.from("chat_messages").select("author_id, kind, body").eq("id", pending.id).eq("organization_id", organizationId).eq("conversation_id", conversationId).maybeSingle();
        if (!existing || existing.author_id !== viewerId || existing.kind !== audience || existing.body !== body) throw error;
      }
      setDrafts(current => ({ ...current, [audience]: "" }));
      pendingMessage.current = null;
      setTyping(false);
      refresh();
    } catch {
      setFeedback("Message not sent. Your draft is still here; try again.");
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || !open || uploadInFlight.current) return;
    if (!validAttachment(file)) { setFeedback("Choose a nonempty image, PDF, text, Word, or Excel file up to 10 MB."); return; }
    uploadInFlight.current = true;
    setUploading(true);
    setFeedback("");
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${organizationId}/${conversationId}/${viewerId}/${crypto.randomUUID()}-${safeName}`;
      const bucket = supabase.storage.from("chat-attachments");
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: () => supabase.from("chat_attachments").insert({ organization_id: organizationId, conversation_id: conversationId, uploaded_by: viewerId, storage_path: path, file_name: file.name, content_type: file.type, size_bytes: file.size }),
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') { setFeedback("Attachment added."); router.refresh(); }
      else if (result === 'unconfirmed') setFeedback("We could not confirm the attachment. Refresh the file list before retrying.");
      else setFeedback("The attachment could not be saved. Choose the file again to retry.");
    } catch { setFeedback("Upload failed. Please try again."); }
    finally { uploadInFlight.current = false; setUploading(false); }
  }

  return <section className="chat-room" aria-label="Conversation"><div className="chat-live-state"><span className={online ? "chat-online" : ""}>{online ? "Another participant online" : "Other participants offline"}</span><span>{connected ? "Live" : "Reconnecting…"}</span></div><Link href={`/app/chat/${conversationId}/history`} target="_blank" rel="noopener noreferrer">Browse earlier messages (opens in a new tab)</Link><div className="chat-thread" ref={threadRef} tabIndex={0} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text">{messages.map(message => <article key={message.id} className={`chat-message${message.author_id === viewerId ? " chat-message-own" : ""}${message.kind === "internal_note" ? " chat-message-note" : ""}`}><div className="chat-message-meta"><strong>{message.author_id === viewerId ? "You" : names[message.author_id] ?? "IT support"}{message.kind === "internal_note" ? " · Internal note" : ""}</strong><time dateTime={message.created_at}>{formatTicketDate(message.created_at)}</time></div><p>{message.body}</p></article>)}{!messages.length && <p className="muted">No messages yet.</p>}</div>{newMessages && <button className="chat-new-messages" type="button" onClick={() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); setSeenMessageId(messages.at(-1)?.id); }}>New messages ↓</button>}<div className="chat-typing" role="status">{typing ? "Someone is typing…" : "\u00a0"}</div>{attachments.length > 0 && <div className="chat-attachments"><h2>Files in this conversation</h2><Link href={`/app/chat/${conversationId}/history?view=files`}>Browse all files</Link><ul>{attachments.map(file => <li key={file.id}>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.file_name}</a> : <span>{file.file_name}</span>}<small>{Math.ceil(file.size_bytes / 1024)} KB</small></li>)}</ul></div>}{open ? <form className={`chat-composer${kind === "internal_note" ? " chat-composer-note" : ""}`} onSubmit={sendMessage}>{isWorker && <label htmlFor="chat-kind">Send as<select id="chat-kind" className="input" value={kind} disabled={sending} onChange={event => setKind(event.target.value as "message" | "internal_note")}><option value="message">Reply to employee</option><option value="internal_note">Internal note · IT only</option></select></label>}<label htmlFor="chat-draft">{kind === "internal_note" && isWorker ? "Internal note · visible only to IT" : "Message"}</label><textarea id="chat-draft" className="input textarea" value={draft} disabled={sending} aria-describedby="chat-audience" onChange={event => announceTyping(event.target.value)} rows={3} maxLength={20000} placeholder="Write a message" required/><p id="chat-audience" className="muted">{kind === "internal_note" ? "Only IT staff can see this note. Attachments are shared with the employee." : "The employee can see this message and attachments."} Enter adds a new line.</p><div className="chat-composer-actions"><label className="button button-secondary chat-file-button"><input type="file" accept={attachmentTypes.join(",")} disabled={uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }}/>{uploading ? "Uploading…" : "Add attachment"}</label><button className="button button-primary" disabled={sending}>{sending ? "Sending…" : kind === "internal_note" && isWorker ? "Add internal note" : "Send message"}</button></div></form> : <p className="chat-closed-note">This conversation is closed. Its history remains available here.</p>}{feedback && <p className="chat-feedback" role="status">{feedback}</p>}</section>;
}
