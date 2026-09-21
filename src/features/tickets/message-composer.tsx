"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function SendButton({ note }: { note: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Sending…" : note ? "Add internal note" : "Send reply"}</button>;
}

export function MessageComposer({ ticketId, action }: { ticketId: string; action: (formData: FormData) => void | Promise<void> }) {
  const [kind, setKind] = useState("reply");
  const note = kind === "internal_note";
  return <form action={action} className="message-form"><input type="hidden" name="ticketId" value={ticketId}/><label htmlFor="message-kind">Message type</label><select id="message-kind" className="input" name="kind" value={kind} onChange={event => setKind(event.target.value)}><option value="reply">Reply to user</option><option value="internal_note">Internal note · team only</option></select><label htmlFor="message-body">{note ? "Internal note · visible only to IT" : "Reply · visible to the requester"}</label><textarea id="message-body" className="input textarea" name="body" required rows={4} maxLength={20000} placeholder={note ? "Add context for your team" : "Write a reply"}/><SendButton note={note}/></form>;
}
