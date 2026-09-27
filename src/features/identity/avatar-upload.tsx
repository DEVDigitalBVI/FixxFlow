"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadAndRegister } from "@/lib/uploads";

export function AvatarUpload({ organizationId, userId }: { organizationId: string; userId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function upload(file: File | undefined) {
    if (!file || inFlight.current) return;
    if (file.size === 0 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a nonempty JPG, PNG, or WebP image up to 5 MB.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setMessage("");
    try {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${organizationId}/${userId}/avatar-${crypto.randomUUID()}.${extension}`;
      const supabase = createClient();
      const bucket = supabase.storage.from("profile-photos");
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: async () => {
          const { data, error } = await supabase.from("profiles").update({ avatar_path: path }).eq("organization_id", organizationId).eq("user_id", userId).select("user_id").maybeSingle();
          return { error: error ?? (!data ? new Error("Profile unavailable") : null), confirmedFailure: !error && !data };
        },
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') { setMessage("Profile photo updated."); router.refresh(); }
      else if (result === 'unconfirmed') setMessage("We could not confirm the photo. Refresh your profile before retrying.");
      else setMessage("The photo could not be saved. Choose it again to retry.");
    } catch {
      setMessage("Upload failed. Choose the photo again to retry.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <div className="upload-control"><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} disabled={pending} /><label className="button button-secondary" htmlFor="avatar-file">{pending ? "Uploading…" : "Choose photo"}</label>{message && <span role="status">{message}</span>}</div>;
}
