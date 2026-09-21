"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never { redirect(`/app/organization?error=${encodeURIComponent(message)}`); }

async function requireAdministrator() {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") fail("Only administrators can manage organization settings.");
  return viewer;
}

export async function addDepartment(formData: FormData) {
  const viewer = await requireAdministrator();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name || name.length > 100) fail("Enter a valid department name.");
  const supabase = await createClient();
  const { error } = await supabase.from("departments").insert({ organization_id: viewer.organizationId, name, description });
  if (error) fail("The department could not be added. Its name may already exist.");
  revalidatePath("/app/organization");
}

export async function addLocation(formData: FormData) {
  const viewer = await requireAdministrator();
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const region = String(formData.get("region") ?? "").trim() || null;
  const countryCode = String(formData.get("countryCode") ?? "").trim().toUpperCase() || null;
  const timezone = String(formData.get("timezone") ?? "America/Tortola").trim();
  if (!name || name.length > 100 || (countryCode && !/^[A-Z]{2}$/.test(countryCode))) fail("Enter valid location details.");
  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert({ organization_id: viewer.organizationId, name, city, region, country_code: countryCode, timezone });
  if (error) fail("The location could not be added. Its name may already exist.");
  revalidatePath("/app/organization");
}

export async function toggleDepartment(formData: FormData) {
  const viewer = await requireAdministrator();
  const id = String(formData.get("id") ?? "");
  const isActive = String(formData.get("isActive")) === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("departments").update({ is_active: !isActive }).eq("organization_id", viewer.organizationId).eq("id", id);
  if (error) fail("The department status could not be changed.");
  revalidatePath("/app/organization");
}

export async function toggleLocation(formData: FormData) {
  const viewer = await requireAdministrator();
  const id = String(formData.get("id") ?? "");
  const isActive = String(formData.get("isActive")) === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("locations").update({ is_active: !isActive }).eq("organization_id", viewer.organizationId).eq("id", id);
  if (error) fail("The location status could not be changed.");
  revalidatePath("/app/organization");
}
