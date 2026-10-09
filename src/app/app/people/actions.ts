"use server";

import type { ActionResult } from "@/lib/action-result";
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

export async function inviteMember(formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") return { error: "Only administrators can invite members." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const role = String(formData.get("role") ?? "end_user") as AppRole;
  const token = String(formData.get("submissionKey") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !displayName || displayName.length > 120 || !allowedRoles.includes(role)) return { error: "Enter a name of up to 120 characters, a valid email, and a valid role." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return { error: "Reload the invitation form before sending. Your entries are preserved." };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Invitations are not configured yet. Contact your workspace administrator." };
  }
  const { data: invitation, error: prepareError } = await admin.rpc("prepare_member_invitation", { org: viewer.organizationId, token, email, display_name: displayName, member_role: role, actor: viewer.id });
  if (prepareError || !invitation) return { error: prepareError?.code === "PT429" ? "An invitation is already being sent. Your entries are preserved; retry in two minutes." : prepareError?.code === "PT409" ? "This account or invitation already exists. Retry with the original invitation details, or manage the member in People." : "The invitation could not be prepared. Your entries are preserved; please try again." };
  if (invitation.completed) return { success: "This invitation is already registered. Manage the member’s access in People." };
  let userId = invitation.userId;
  if (!userId) {
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback?next=/auth/update-password`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) return { error: "We could not confirm the invitation email. Your entries are preserved. Retry in two minutes; any account already invited will be recovered without sending a duplicate." };
    userId = data.user.id;
  }
  const { error: registrationError } = await admin.rpc("complete_member_invitation", { org: viewer.organizationId, token: invitation.id, invited_user: userId, actor: viewer.id });
  if (registrationError) return { error: "The invitation email was accepted, but workspace access needs repair. Your entries are preserved. Send again to repair access; another invitation email will not be sent." };
  revalidatePath("/app/people");
  return { success: invitation.userId ? "Workspace access repaired. The existing invitation email can be used; request a password reset if its link has expired." : "Invitation email accepted and workspace access created." };
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
