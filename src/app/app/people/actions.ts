"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, MembershipStatus } from "@/types/database";

const allowedRoles: AppRole[] = ["end_user", "technician", "administrator"];

function peopleError(message: string): never {
  redirect(`/app/people?${new URLSearchParams({ error: message })}`);
}

export async function updateMemberRole(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") peopleError("Only administrators can change roles.");

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  if (!userId || !allowedRoles.includes(role)) peopleError("Choose a valid role.");

  const supabase = await createClient();
  const { error } = await supabase.from("organization_memberships").update({ role }).eq("organization_id", viewer.organizationId).eq("user_id", userId);
  if (error) peopleError("The member role could not be updated.");
  revalidatePath("/app/people");
}

export async function updateMemberStatus(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") peopleError("Only administrators can change account access.");

  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as MembershipStatus;
  if (!userId || !["active", "inactive"].includes(status)) peopleError("Choose a valid account status.");
  if (userId === viewer.id && status === "inactive") peopleError("You cannot deactivate your own account.");

  const supabase = await createClient();
  const { error } = await supabase.from("organization_memberships").update({
    status,
    deactivated_at: status === "inactive" ? new Date().toISOString() : null,
    activated_at: status === "active" ? new Date().toISOString() : undefined,
  }).eq("organization_id", viewer.organizationId).eq("user_id", userId);
  if (error) peopleError("The member access status could not be updated.");
  revalidatePath("/app/people");
}
