"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AvatarUpload({ organizationId, userId }: { organizationId: string; userId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPG, PNG, or WebP image smaller than 5 MB.");
      return;
    }
    setPending(true); setMessage("");
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${organizationId}/${userId}/avatar-${crypto.randomUUID()}.${extension}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage.from("profile-photos").upload(path, file, { contentType: file.type });
    const { error: profileError } = uploadError ? { error: uploadError } : await supabase.from("profiles").update({ avatar_path: path }).eq("organization_id", organizationId).eq("user_id", userId);
    setPending(false);
    if (profileError) { setMessage("The photo could not be uploaded."); return; }
    setMessage("Profile photo updated."); router.refresh();
  }

  return <div className="upload-control"><input ref={input} id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={pending} /><label className="button button-secondary" htmlFor="avatar-file">{pending ? "Uploading…" : "Choose photo"}</label>{message && <span role="status">{message}</span>}</div>;
}
