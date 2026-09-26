"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/components/ui/action-form";

export async function saveClassification(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") return { error: "Only administrators can manage these settings." };
  const kind = String(form.get("kind") ?? "");
  if (kind !== "teams" && kind !== "ticket_categories" && kind !== "ticket_subcategories") return { error: "Choose a valid setting." };
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 100) return { error: "Enter a name between 1 and 100 characters." };
  const supabase = await createClient();
  const categoryId = String(form.get("categoryId") ?? "");
  if (kind === "ticket_subcategories") {
    const { data, error } = await supabase.from("ticket_categories").select("id").eq("organization_id", viewer.organizationId).eq("id", categoryId).maybeSingle();
    if (error || !data) return { error: "This category is unavailable. Reload the page and try again." };
  }
  const defaultTeamId = String(form.get("defaultTeamId") ?? "") || null;
  if (kind === "ticket_categories" && defaultTeamId) {
    const { data, error } = await supabase.from("teams").select("id").eq("organization_id", viewer.organizationId).eq("id", defaultTeamId).eq("is_active", true).maybeSingle();
    if (error || !data) return { error: "Choose an active team for automatic routing, or select no default." };
  }
  const changes = { name, is_active: form.get("isActive") === "true" };
  let result;
  if (id) {
    // Compare the version rendered in the form to avoid silently overwriting another admin.
    result = kind === "ticket_subcategories"
      ? await supabase.from(kind).update(changes).eq("organization_id", viewer.organizationId).eq("id", id).eq("category_id", categoryId).eq("updated_at", String(form.get("updatedAt") ?? "")).select("id").maybeSingle()
      : kind === "ticket_categories"
      ? await supabase.from(kind).update({ ...changes, default_team_id: defaultTeamId }).eq("organization_id", viewer.organizationId).eq("id", id).eq("updated_at", String(form.get("updatedAt") ?? "")).select("id").maybeSingle()
      : await supabase.from(kind).update(changes).eq("organization_id", viewer.organizationId).eq("id", id).eq("updated_at", String(form.get("updatedAt") ?? "")).select("id").maybeSingle();
  } else if (kind === "ticket_subcategories") {
    result = await supabase.from(kind).insert({ ...changes, organization_id: viewer.organizationId, category_id: categoryId }).select("id").single();
  } else if (kind === "ticket_categories") {
    result = await supabase.from(kind).insert({ ...changes, organization_id: viewer.organizationId, default_team_id: defaultTeamId }).select("id").single();
  } else {
    result = await supabase.from(kind).insert({ ...changes, organization_id: viewer.organizationId }).select("id").single();
  }
  if (result.error?.code === "23505") return { error: "That name already exists here. Choose a different name." };
  if (result.error) return { error: "The setting could not be saved. Your entries are preserved; try again." };
  if (!result.data) return { error: "This setting changed or was removed. Reload to see the latest version before saving again." };
  revalidatePath("/app/administration");
  revalidatePath(`/app/administration/${kind === "teams" ? "teams" : "categories"}`);
  revalidatePath("/app/tickets", "layout");
  return { success: id ? "Changes saved." : "Added successfully." };
}
