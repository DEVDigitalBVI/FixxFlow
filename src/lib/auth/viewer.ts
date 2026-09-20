import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, MembershipStatus } from "@/types/database";

export type Viewer = {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  role: AppRole;
  status: MembershipStatus;
};

export async function requireViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (error || !userId) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/account/unassigned");
  if (membership.status !== "active") redirect("/account/inactive");

  const [{ data: organization }, { data: profile }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", membership.organization_id).single(),
    supabase.from("profiles").select("display_name").eq("organization_id", membership.organization_id).eq("user_id", userId).maybeSingle(),
  ]);

  return {
    id: userId,
    email: typeof claims.claims.email === "string" ? claims.claims.email : "",
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "Organization",
    displayName: profile?.display_name ?? (typeof claims.claims.email === "string" ? claims.claims.email : "User"),
    role: membership.role,
    status: membership.status,
  };
}
