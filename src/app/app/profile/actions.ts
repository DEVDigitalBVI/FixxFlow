"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export async function updateProfile(formData: FormData) {
  const viewer = await requireViewer();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const locationId = String(formData.get("locationId") ?? "") || null;
  if (!displayName || displayName.length > 120) redirect("/app/profile?error=Enter a valid display name.");

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: displayName, job_title: jobTitle, phone, department_id: departmentId, location_id: locationId }).eq("organization_id", viewer.organizationId).eq("user_id", viewer.id);
  if (error) redirect("/app/profile?error=Your profile could not be updated.");
  revalidatePath("/app", "layout");
  redirect("/app/profile?success=Profile updated.");
}

export async function updateUsagePreference(formData: FormData) {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const {error} = await supabase.from("product_usage_preferences").upsert({user_id:viewer.id,enabled:formData.get("shareUsage")==="on"});
  if(error)redirect("/app/profile?error=Your usage preference could not be saved. Please try again.");
  revalidatePath("/app", "layout");
  redirect("/app/profile?success=Usage preference saved.");
}
