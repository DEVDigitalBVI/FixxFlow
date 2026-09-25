import { redirect } from "next/navigation";
import { cache } from "react";
import { requireAssurance } from "@/lib/auth/assurance";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, MembershipStatus } from "@/types/database";

export type Viewer = {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  avatarUrl: string | null;
  role: AppRole;
  status: MembershipStatus;
  usageSharing: boolean;
};

export const requireViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (error || !userId) redirect("/login");

  await requireAssurance(supabase);

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    const {data: ownerAccess} = await supabase.rpc("platform_access");
    if (ownerAccess && ownerAccess !== "none") redirect("/platform");
    redirect("/account/unassigned");
  }
  if (membership.status !== "active") redirect("/account/inactive");

  const [{ data: organization }, { data: profile }, {data: usagePreference}] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", membership.organization_id).single(),
    supabase.from("profiles").select("display_name, avatar_path").eq("organization_id", membership.organization_id).eq("user_id", userId).maybeSingle(),
    supabase.from("product_usage_preferences").select("enabled").eq("user_id", userId).maybeSingle(),
  ]);

  const { data: avatar } = profile?.avatar_path
    ? await supabase.storage.from("profile-photos").createSignedUrl(profile.avatar_path, 3600)
    : { data: null };

  return {
    id: userId,
    email: typeof claims.claims.email === "string" ? claims.claims.email : "",
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "Organization",
    displayName: profile?.display_name ?? (typeof claims.claims.email === "string" ? claims.claims.email : "User"),
    avatarUrl: avatar?.signedUrl ?? null,
    role: membership.role,
    status: membership.status,
    usageSharing: usagePreference?.enabled === true,
  };
});
