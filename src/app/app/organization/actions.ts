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

async function deleteOrganizationItem(table: "departments" | "locations", formData: FormData) {
  const viewer = await requireAdministrator();
  const id = String(formData.get("id") ?? "");
  const label = table === "departments" ? "department" : "location";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail(`Choose a valid ${label}.`);
  if (formData.get("confirmDelete") !== id) fail(`Confirm that you want to permanently delete this ${label}.`);
  const supabase = await createClient();
  // Foreign keys enforce this atomically, including references added during the request.
  const { data, error } = await supabase.from(table).delete().eq("organization_id", viewer.organizationId).eq("id", id).select("id").maybeSingle();
  if (error?.code === "23503") fail(table === "departments"
    ? "This department is linked to people. Deactivate it to keep those links, or reassign the people before deleting it."
    : "This location is linked to people, tickets, or assets. Deactivate it to preserve those records. Only unused locations can be deleted.");
  if (error) fail(`The ${label} could not be deleted. Please try again.`);
  if (!data) fail(`This ${label} is no longer available. Refresh the page to see the current list.`);
  revalidatePath("/app/organization");
  redirect(`/app/organization?success=${encodeURIComponent(`${label === "department" ? "Department" : "Location"} deleted.`)}#${table}`);
}

export async function deleteDepartment(formData: FormData) {
  return deleteOrganizationItem("departments", formData);
}

export async function deleteLocation(formData: FormData) {
  return deleteOrganizationItem("locations", formData);
}
