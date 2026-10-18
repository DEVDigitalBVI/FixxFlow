"use client";
import { ChatReadUpdates } from "./read-updates";
import { HISTORY_PAGE_SIZE } from "@/features/conversations/history";
import { Timestamp } from '@/features/timezones/provider';

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouteRefresh } from "@/lib/realtime/use-route-refresh";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { uploadAndRegister } from "@/lib/uploads";
import { chatAttachmentTypes, validChatAttachment } from "./media";
import { ChatMediaAttachment } from "./media-attachment";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedChanges } from '@/components/ui/unsaved-changes';

export type RoomMessage = { id: string; author_id: string; kind: "message" | "internal_note"; body: string; created_at: string };
export type RoomAttachment = { id: string; file_name: string; size_bytes: number; created_at: string; storage_path: string; content_type?: string; uploaded_by?: string; url?: string };


export function ChatRoom({ conversationId, organizationId, viewerId, isWorker, open, names, initialMessages, attachments: initialAttachments, readThrough }: {
  conversationId: string; organizationId: string; viewerId: string; isWorker: boolean; open: boolean;
  names: Record<string, string>; initialMessages: RoomMessage[]; attachments: RoomAttachment[]; readThrough?: string;
}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);
  const remoteTimer = useRef<number | null>(null);
  const lastTyping = useRef(0);
  const [liveMessages, setLiveMessages] = useState<RoomMessage[]>([]);
  const [outgoing, setOutgoing] = useState<RoomMessage | null>(null);
  const confirmed = new Map(liveMessages.map(message => [message.id, message]));
  for (const message of initialMessages) confirmed.set(message.id, message);
  const messages = [...confirmed.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-HISTORY_PAGE_SIZE);
  if (outgoing && !confirmed.has(outgoing.id)) messages.push(outgoing);
  const [liveAttachments, setLiveAttachments] = useState<RoomAttachment[]>([]);
  const files = new Map(liveAttachments.map(file => [file.id, file]));
  for (const file of initialAttachments) files.set(file.id, file);
  const attachments = [...files.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)).slice(-HISTORY_PAGE_SIZE);
  type Entry = { key: string; created_at: string } & ({ type: 'message'; message: RoomMessage } | { type: 'file'; file: RoomAttachment });
  const timeline: Entry[] = [...messages.map(message => ({ type: 'message' as const, key: `message:${message.id}`, created_at: message.created_at, message })), ...attachments.map(file => ({ type: 'file' as const, key: `file:${file.id}`, created_at: file.created_at, file }))]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.key.localeCompare(b.key));
  const latestMessageId = timeline.at(-1)?.key;
  const followLatest = useRef(true);
  const [readingHistory, setReadingHistory] = useState(false);
  const [drafts, setDrafts] = useState({ message: "", internal_note: "" });
  const [kind, setKind] = useState<"message" | "internal_note">(isWorker ? "internal_note" : "message");
  const draft = drafts[kind];
  const pendingMessage = useRef<{ id: string; body: string; kind: typeof kind } | null>(null);
  const sendInFlight = useRef(false);
  const uploadInFlight = useRef(false);

  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [failedUpload, setFailedUpload] = useState<File | null>(null);
  useUnsavedChanges(Boolean(drafts.message.trim() || drafts.internal_note.trim() || uploading));
  const [feedback, setFeedback] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [seenMessageId, setSeenMessageId] = useState(latestMessageId);
  const newMessages = timeline.length > 0 && latestMessageId !== seenMessageId;
  const refresh = useRouteRefresh(connected ? 60000 : 15000);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && followLatest.current) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "instant" });
    }
  }, [latestMessageId, uploading]);

  useEffect(() => {
    let disposed = false;
    const channel = supabase.channel(`chat:${conversationId}`, { config: { private: true, presence: { key: `${viewerId}:${crypto.randomUUID()}` } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => {
        if (disposed || row.organization_id !== organizationId || row.conversation_id !== conversationId
          || (row.kind !== "message" && row.kind !== "internal_note") || (!isWorker && row.kind === "internal_note")
          || typeof row.id !== "string" || typeof row.author_id !== "string" || typeof row.body !== "string" || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return;
        const message: RoomMessage = { id: row.id, author_id: row.author_id, kind: row.kind, body: row.body, created_at: row.created_at };
        setLiveMessages(current => [...current.filter(item => item.id !== message.id), message].slice(-HISTORY_PAGE_SIZE));
      })
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
        if (status !== "SUBSCRIBED") { setOnline(false); setTyping(false); }
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
  }, [conversationId, organizationId, viewerId, isWorker, supabase, refresh]);

  function stopTyping() {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: viewerId, typing: false } });
  }

  function announceTyping(value: string) {
    setDrafts(current => ({ ...current, [kind]: value }));
    if (kind === "internal_note" || !value.trim() || !connected) { stopTyping(); return; }
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
    followLatest.current = true;
    setReadingHistory(false);
    setOutgoing({ ...pending, author_id: viewerId, created_at: new Date().toISOString() });
    stopTyping();
    setSending(true); setFeedback("");
    try {
      const { data, error } = await supabase.from("chat_messages").insert({ id: pending.id, organization_id: organizationId, conversation_id: conversationId, author_id: viewerId, kind: audience, body }).select("id, author_id, kind, body, created_at").single();
      let saved = data;
      if (error) {
        const { data: existing } = await supabase.from("chat_messages").select("id, author_id, kind, body, created_at").eq("id", pending.id).eq("organization_id", organizationId).eq("conversation_id", conversationId).maybeSingle();
        if (!existing || existing.author_id !== viewerId || existing.kind !== audience || existing.body !== body) throw error;
        saved = existing;
      }
      if (saved) setLiveMessages(current => [...current.filter(item => item.id !== saved.id), saved].slice(-HISTORY_PAGE_SIZE));
      setDrafts(current => ({ ...current, [audience]: current[audience] === draft ? "" : current[audience] }));
      pendingMessage.current = null;
      refresh();
    } catch {
      setFeedback("Message not sent. Your draft is still here; try again.");
    } finally {
      setOutgoing(null);
      sendInFlight.current = false;
      setSending(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || !open || uploadInFlight.current) return;
    if (!validChatAttachment(file)) { setFeedback("Choose a nonempty photo, MP4, WebM, MOV, audio, PDF, text, Word, or Excel file up to 10 MB."); return; }
    uploadInFlight.current = true;
    followLatest.current = true;
    setReadingHistory(false);
    setUploading(true);
    setUploadName(file.name);
    setFailedUpload(null);
    setFeedback(`Uploading ${file.name}…`);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${organizationId}/${conversationId}/${viewerId}/${crypto.randomUUID()}-${safeName}`;
      const bucket = supabase.storage.from("chat-attachments");
      let savedFile: RoomAttachment | undefined;
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: async () => {
          const result = await supabase.from("chat_attachments").insert({ organization_id: organizationId, conversation_id: conversationId, uploaded_by: viewerId, storage_path: path, file_name: file.name, content_type: file.type, size_bytes: file.size })
            .select("id, file_name, size_bytes, created_at, storage_path, content_type, uploaded_by").single();
          if (result.data) savedFile = result.data;
          return result;
        },
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') {
        if (savedFile) {
          let url: string | undefined;
          try { const { data: signed } = await bucket.createSignedUrl(path, 3600); url = signed?.signedUrl; }
          catch { /* The file is saved; leave renewal to the shared media retry control. */ }
          const attachment = { ...savedFile, url };
          setLiveAttachments(current => [...current.filter(item => item.id !== attachment.id), attachment].slice(-HISTORY_PAGE_SIZE));
        }
        setFeedback("Attachment added."); router.refresh();
      }
      else if (result === 'unconfirmed') setFeedback("We could not confirm the attachment. Refresh the file list before retrying.");
      else { setFailedUpload(file); setFeedback("The attachment could not be saved. Retry the upload or choose another file."); }
    } catch { setFeedback("The upload could not be confirmed. Refresh the file list before trying again."); }
    finally { uploadInFlight.current = false; setUploading(false); }
  }

  return <section className="chat-room" aria-label="Conversation"><div className="chat-live-state" role="status"><span className={online ? "chat-online" : ""}>{online ? "Another participant online" : "Waiting for another participant"}</span><span>{connected ? "Live" : "Reconnecting · updates may be delayed"}</span></div><Link className="chat-history-link" href={`/app/chat/${conversationId}/history`} target="_blank" rel="noopener noreferrer">Earlier messages <span className="sr-only">(opens in a new tab)</span></Link><div className="chat-thread" ref={threadRef} onScroll={event => {
    const thread = event.currentTarget;
    followLatest.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    setReadingHistory(!followLatest.current);
    if (followLatest.current) setSeenMessageId(latestMessageId);
  }} tabIndex={0} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text">{timeline.map(entry => {
    if (entry.type === "file") return <article key={entry.key} className={`chat-message chat-message-media${entry.file.uploaded_by === viewerId ? " chat-message-own" : ""}`}><div className="chat-message-meta"><strong>{entry.file.uploaded_by === viewerId ? "You" : names[entry.file.uploaded_by ?? ""] ?? "Participant"} · Attachment</strong><time dateTime={entry.created_at}><Timestamp value={entry.created_at}/></time></div><ChatMediaAttachment file={entry.file} onReady={() => { if (followLatest.current) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "instant" }); }}/></article>;
    const message = entry.message;
    return <article key={entry.key} className={`chat-message${message.author_id === viewerId ? " chat-message-own" : ""}${message.kind === "internal_note" ? " chat-message-note" : ""}`}><div className="chat-message-meta"><strong>{message.author_id === viewerId ? "You" : names[message.author_id] ?? "IT support"}{message.kind === "internal_note" ? " · Internal note" : ""}</strong><time dateTime={message.created_at}><Timestamp value={message.created_at}/></time></div><p>{message.body}</p>{outgoing?.id === message.id && !confirmed.has(message.id) && <small>Sending…</small>}</article>;
  })}{uploading && <article className="chat-message chat-message-own" aria-label="Uploading attachment"><p>Uploading {uploadName}…</p></article>}{!timeline.length && !uploading && <p className="muted">No messages yet.</p>}</div>{newMessages && readingHistory && <button className="chat-new-messages" type="button" onClick={() => { followLatest.current = true; setReadingHistory(false); threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); setSeenMessageId(latestMessageId); }}>New messages ↓</button>}<div className="chat-typing" role="status">{typing ? "Someone is typing…" : "\u00a0"}</div>{attachments.length > 0 && <details className="chat-attachments"><summary>Files in this conversation ({attachments.length})</summary><Link className="button button-secondary" href={`/app/chat/${conversationId}/history?view=files`}>Browse all files</Link><ul>{attachments.map(file => <li key={file.id}>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.file_name}</a> : <span>{file.file_name}</span>}<small>{Math.ceil(file.size_bytes / 1024)} KB</small></li>)}</ul></details>}{open ? <form className={`chat-composer${kind === "internal_note" ? " chat-composer-note" : ""}`} onSubmit={sendMessage}>{isWorker && <label htmlFor="chat-kind">Send as<select id="chat-kind" className="input" value={kind} disabled={sending} onChange={event => { stopTyping(); setKind(event.target.value as "message" | "internal_note"); }}><option value="message">Reply to employee</option><option value="internal_note">Internal note · IT only</option></select></label>}<label htmlFor="chat-draft">{kind === "internal_note" && isWorker ? "Internal note · visible only to IT" : "Message"}</label><textarea id="chat-draft" className="input textarea" value={draft} aria-describedby="chat-audience" onChange={event => announceTyping(event.target.value)} onBlur={stopTyping} onKeyDown={event => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }} rows={2} maxLength={20000} placeholder="Write a message" required/><p id="chat-audience" className="muted">{kind === "internal_note" ? "Only IT staff can see this note. Attachments are shared with the employee." : "The employee can see this message and attachments."} Enter to send · Shift+Enter for a new line.</p><div className="chat-composer-actions"><label className="button button-secondary chat-file-button"><input type="file" accept={chatAttachmentTypes.join(",")} aria-describedby="chat-upload-hint" disabled={uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }}/>{uploading ? "Uploading…" : "Add media or file"}</label><button className="button button-primary" disabled={sending || !draft.trim()}>{sending ? "Sending…" : kind === "internal_note" && isWorker ? "Add internal note" : "Send message"}</button></div><details className="chat-upload-guide"><summary>Media &amp; files · up to 10 MB</summary><p id="chat-upload-hint" className="muted">Photos (JPEG, PNG, WebP), video (MP4, WebM, MOV), audio (MP3, M4A, WAV, WebM, Ogg), PDF, text, Word, or Excel. Include a text description of visual or spoken content in your message.</p></details></form> : <p className="chat-closed-note">This conversation is closed. Its history remains available here.</p>}{feedback && <p className="chat-feedback" role="status">{feedback}</p>}{failedUpload && !uploading && open && <button className="button button-secondary chat-upload-retry" type="button" onClick={() => void upload(failedUpload)}>Retry upload: {failedUpload.name}</button>}{readThrough && <ChatReadUpdates conversationId={conversationId} organizationId={organizationId} viewerId={viewerId} through={readThrough} active={!readingHistory}/>}</section>;
}
