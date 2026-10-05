"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TicketMessageKind } from "@/types/database";
import { messageKinds } from "./message-presentation";

export type MessageResult = { error?: string; success?: string };

export function MessageComposer({ ticketId, action, staff = true }: {
  ticketId: string;
  staff?: boolean;
  action: (formData: FormData) => Promise<MessageResult>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<TicketMessageKind>(staff ? "internal_note" : "reply");
  const [drafts, setDrafts] = useState({ reply: "", internal_note: "" });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MessageResult>({});
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mode = messageKinds[kind];

  async function send(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult({});
    requestId.current ??= crypto.randomUUID();
    formData.set("messageId", requestId.current);
    try {
      const response = await action(formData);
      setResult(response);
      if (!response.error) {
        setDrafts(current => ({ ...current, [kind]: "" }));
        requestId.current = null;
        router.refresh();
      }
    } catch {
      setResult({ error: "Your message could not be confirmed. Your draft is kept here; try sending again." });
    } finally {
      inFlight.current = false;
      setPending(false);
      textarea.current?.focus();
    }
  }

  return <form action={send} className={`message-composer composer-${kind}`} aria-busy={pending}>
    <input type="hidden" name="ticketId" value={ticketId}/>
    <input type="hidden" name="kind" value={kind}/>
    {staff && <fieldset className="composer-modes" disabled={pending}>
      <legend>Message type</legend>
      {Object.entries(messageKinds).map(([value, presentation]) => <label key={value}>
        <input type="radio" name="composerMode" value={value} checked={kind === value} onChange={() => { setKind(value as TicketMessageKind); setResult({}); requestId.current = null; }}/>
        {presentation.label}
      </label>)}
    </fieldset>}
    <div className="composer-audience" id="message-audience" role="status"><strong>{staff ? mode.label : "Reply to IT"}</strong><span>{staff ? mode.audience : "Visible to you and IT support."}</span></div>
    <label htmlFor="message-body">{staff ? mode.label : "Your message"}</label>
    <textarea ref={textarea} id="message-body" className="input textarea" name="body" required rows={4} maxLength={20000} readOnly={pending} value={drafts[kind]} onChange={event => { setDrafts(current => ({ ...current, [kind]: event.target.value })); requestId.current = null; }} aria-describedby={`message-audience message-hint${result.error ? " message-error" : ""}`} placeholder={kind === "internal_note" ? "Share troubleshooting details with IT staff…" : "Write a message…"}/>
    <div className="composer-footer"><small id="message-hint">Enter adds a new line. {staff && "Drafts stay separate for each message type."}</small><button className={`button ${kind === "internal_note" ? "button-note" : "button-primary"}`} type="submit" disabled={pending}>{pending ? "Sending…" : mode.action}</button></div>
    {result.error && <p id="message-error" className="alert alert-error" role="alert">{result.error}</p>}
    <p className="composer-result" role="status">{result.success}</p>
  </form>;
}
