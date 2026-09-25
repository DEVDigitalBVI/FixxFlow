"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole, MembershipStatus } from "@/types/database";

const allowedRoles: AppRole[] = ["end_user", "technician", "administrator"];

function peopleError(message: string): never {
  redirect(`/app/people?${new URLSearchParams({ error: message })}`);
}

export async function inviteMember(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") peopleError("Only administrators can invite members.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const role = String(formData.get("role") ?? "end_user") as AppRole;
  if (!email || !displayName || !allowedRoles.includes(role)) peopleError("Enter a name, email, and valid role.");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    peopleError("Invitations are not configured yet. Add the Supabase server secret to the deployment.");
  }
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback?next=/auth/update-password`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error || !data.user) peopleError("The invitation could not be sent.");

  const { error: registrationError } = await admin.rpc("register_invited_member", {
    target_organization_id: viewer.organizationId,
    invited_user_id: data.user.id,
    invited_role: role,
    invited_name: displayName,
    invited_email: email,
    invited_by: viewer.id,
  });
  if (registrationError) peopleError("The email invitation was sent, but workspace access could not be created. Please contact an administrator.");

  redirect("/app/people?success=Invitation sent.");
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
