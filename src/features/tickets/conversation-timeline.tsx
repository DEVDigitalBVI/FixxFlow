"use client";

import { useRef, useState } from "react";
import type { TicketMessageKind } from "@/types/database";
import { formatTicketDate } from "./presentation";
import { messageKinds } from "./message-presentation";

type Message = { id: string; author_id: string; kind: TicketMessageKind; body: string; created_at: string };

export function ConversationTimeline({ messages, names, viewerId, requesterId, staff, error }: {
  messages: Message[]; names: Map<string, string>; viewerId: string; requesterId: string; staff: boolean; error: boolean;
}) {
  const [seen, setSeen] = useState(() => new Set(messages.map(message => message.id)));
  const list = useRef<HTMLOListElement>(null);
  const newCount = messages.filter(message => !seen.has(message.id) && (staff || message.kind === "reply")).length;
  if (error) return <p className="alert alert-error" role="alert">Conversation could not be loaded. Refresh the page to try again.</p>;
  const visible = staff ? messages : messages.filter(message => message.kind === "reply");
  if (!visible.length) return <p className="conversation-empty">No messages yet. Replies from IT will appear here.</p>;
  return <><div role="status">{newCount > 0 && <button type="button" className="button button-secondary" onClick={() => { setSeen(new Set(messages.map(message => message.id))); const last = list.current?.lastElementChild?.firstElementChild as HTMLElement | null; last?.focus({ preventScroll: true }); last?.scrollIntoView({ block: "nearest" }); }}>{newCount} new message{newCount === 1 ? "" : "s"} · View latest</button>}</div><ol ref={list} className="ticket-conversation" aria-label="Ticket messages">{visible.map(message => {
    const own = message.author_id === viewerId;
    const note = message.kind === "internal_note";
    return <li key={message.id} className={`conversation-item ${own ? "conversation-item-own" : ""} ${note ? "conversation-item-note" : ""}`}>
      <article tabIndex={-1} className="conversation-bubble">
        <header><strong>{own ? "You" : names.get(message.author_id) ?? "Team member"}</strong><span>{message.author_id === requesterId ? "Requester" : "IT staff"}</span><time dateTime={message.created_at}>{formatTicketDate(message.created_at)}</time></header>
        {staff && <div className="message-visibility"><strong>{messageKinds[message.kind].label}</strong><span>{note ? "IT staff only" : "Visible to requester"}</span></div>}
        <p>{message.body}</p>
      </article>
    </li>;
  })}</ol></>;
}
