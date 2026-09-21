"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function bootstrapOrganization(formData: FormData) {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const organizationSlug = String(formData.get("organizationSlug") ?? "").trim().toLowerCase();
  const administratorName = String(formData.get("administratorName") ?? "").trim();

  if (!organizationName || !administratorName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    redirect(`/account/unassigned?${new URLSearchParams({ error: "Enter a valid organization name, URL identifier, and your name." })}`);
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) redirect("/login");

  let error: { message: string } | null = null;
  try {
    const admin = createAdminClient();
    ({ error } = await admin.rpc("bootstrap_organization", {
      organization_name: organizationName,
      organization_slug: organizationSlug,
      administrator_name: administratorName,
      administrator_user_id: userId,
    }));
  } catch {
    redirect(`/account/unassigned?${new URLSearchParams({ error: "Organization setup requires the Supabase server secret." })}`);
  }

  if (error) redirect(`/account/unassigned?${new URLSearchParams({ error: error.message.includes("organizations_slug_key") || error.message.includes("duplicate key") ? "That workspace identifier is already in use. Choose another." : "We could not create your organization. Check the details and try again." })}`);

  redirect("/app");
}
