"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type ReadState = { error?: string; success?: boolean };
export async function markNotificationsRead(_state: ReadState, formData: FormData): Promise<ReadState> {
  const viewer = await requireViewer();
  const id = String(formData.get("notificationId") ?? "");
  const all = formData.get("all") === "true";
  if (!all && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { error: "Choose a notification and try again." };
  try {
  const supabase = await createClient();
  let query = supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("organization_id", viewer.organizationId).eq("recipient_id", viewer.id).is("read_at", null);
  if (!all) query = query.eq("id", id);
  const { error } = await query;
  if (error) return { error: "Could not mark notifications as read. Please try again." };
  } catch { return { error: "Could not mark notifications as read. Please try again." }; }
  revalidatePath("/app/notifications");
  return { success: true };
}
