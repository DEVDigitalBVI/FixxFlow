"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function bootstrapOrganization(formData: FormData) {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const organizationSlug = String(formData.get("organizationSlug") ?? "").trim().toLowerCase();
  const administratorName = String(formData.get("administratorName") ?? "").trim();

  if (!organizationName || !administratorName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    redirect(`/account/unassigned?${new URLSearchParams({ error: "Enter a valid organization name, URL identifier, and your name." })}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_organization", {
    organization_name: organizationName,
    organization_slug: organizationSlug,
    administrator_name: administratorName,
  });

  if (error) {
    redirect(`/account/unassigned?${new URLSearchParams({ error: "Setup is unavailable. Ask an administrator to add your account." })}`);
  }

  redirect("/app");
}
