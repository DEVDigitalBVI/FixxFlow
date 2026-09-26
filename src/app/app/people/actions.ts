"use server";

import type { ActionResult } from "@/components/ui/action-form";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole, MembershipStatus } from "@/types/database";



export async function updateMemberDetails(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") return { error: "Only administrators can edit member details." };
  const userId = String(form.get("userId") ?? "");
  const departmentId = String(form.get("departmentId") ?? "") || null;
  const locationId = String(form.get("locationId") ?? "") || null;
  const jobTitle = String(form.get("jobTitle") ?? "").trim() || null;
  if ((jobTitle?.length ?? 0) > 120) return { error: "Keep the job title within 120 characters." };
  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase.from("profiles").select("department_id, location_id").eq("organization_id", viewer.organizationId).eq("user_id", userId).maybeSingle();
  if (currentError || !current) return { error: "This member's profile could not be loaded. Reload and try again." };
  for (const [table, id, previous] of [["departments", departmentId, current.department_id], ["locations", locationId, current.location_id]] as const) {
    if (!id || id === previous) continue;
    const { data, error } = await supabase.from(table).select("id").eq("organization_id", viewer.organizationId).eq("id", id).eq("is_active", true).maybeSingle();
    if (error || !data) return { error: `Choose an active ${table === "departments" ? "department" : "location"}.` };
  }
  const { data, error } = await supabase.from("profiles").update({ department_id: departmentId, location_id: locationId, job_title: jobTitle }).eq("organization_id", viewer.organizationId).eq("user_id", userId).eq("updated_at", String(form.get("updatedAt") ?? "")).select("user_id").maybeSingle();
  if (error) return { error: "Member details could not be saved. Your entries are preserved; try again." };
  if (!data) return { error: "This profile changed. Reload to see the current details before saving again." };
  revalidatePath("/app/people"); revalidatePath("/app/organization"); revalidatePath("/app/profile");
  return { success: "Member details saved." };
}

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
