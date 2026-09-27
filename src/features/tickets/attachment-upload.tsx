"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachmentTypes, uploadAndRegister, validAttachment } from "@/lib/uploads";

export function AttachmentUpload({ organizationId, ticketId, userId }: { organizationId: string; ticketId: string; userId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function upload(file: File | undefined) {
    if (!file || inFlight.current) return;
    if (!validAttachment(file)) {
      setMessage("Use a nonempty image, PDF, text, Word, or Excel file up to 10 MB.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${organizationId}/${ticketId}/${userId}/${crypto.randomUUID()}-${safeName}`;
      const bucket = supabase.storage.from("ticket-attachments");
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: () => supabase.from("ticket_attachments").insert({ organization_id: organizationId, ticket_id: ticketId, uploaded_by: userId, storage_path: path, file_name: file.name, content_type: file.type, size_bytes: file.size }),
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') { setMessage("Attachment added."); router.refresh(); }
      else if (result === 'unconfirmed') setMessage("We could not confirm the attachment. Refresh the file list before retrying.");
      else setMessage("The attachment could not be saved. Choose the file again to retry.");
    } catch {
      setMessage("Upload failed. Choose the file again to retry.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="attachment-upload"><label className="button button-secondary"><input type="file" accept={attachmentTypes.join(",")} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />{busy ? "Uploading…" : "Add attachment"}</label>{message && <span role="status">{message}</span>}</div>;
}
