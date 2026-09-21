"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export function AttachmentUpload({ organizationId, ticketId, userId }: { organizationId: string; ticketId: string; userId: string }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (!allowed.has(file.type) || file.size > 10 * 1024 * 1024) { setMessage("Use an image, PDF, text, Word, or Excel file under 10 MB."); return; }
    setBusy(true); setMessage("");
    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${organizationId}/${ticketId}/${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("ticket-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setMessage("Upload failed. Please try again."); setBusy(false); return; }
    const { error } = await supabase.from("ticket_attachments").insert({ organization_id: organizationId, ticket_id: ticketId, uploaded_by: userId, storage_path: path, file_name: file.name, content_type: file.type, size_bytes: file.size });
    if (error) { await supabase.storage.from("ticket-attachments").remove([path]); setMessage("The attachment could not be saved."); }
    else { setMessage("Attachment added."); router.refresh(); }
    setBusy(false);
  }
  return <div className="attachment-upload"><label className="button button-secondary"><input type="file" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} />{busy ? "Uploading…" : "Add attachment"}</label>{message && <span role="status">{message}</span>}</div>;
}
