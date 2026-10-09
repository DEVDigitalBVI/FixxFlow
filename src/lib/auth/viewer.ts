import { cookies } from "next/headers";
import { resolveTimezone, TIMEZONE_COOKIE } from "@/features/timezones/model";
import { reportServerError } from "@/lib/server-errors";
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
  avatarPath: string | null;
  role: AppRole;
  status: MembershipStatus;
  usageSharing: boolean;
  organizationTimezone: string;
  timezonePreference: string | null;
  timeZone: string;
};

export const requireViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (error || !userId) redirect("/login");

  // These checks are independent, but both must finish before granting access.
  const [, { data: membership, error: membershipError }] = await Promise.all([
    requireAssurance(supabase),
    supabase
      .from("organization_memberships")
      .select("organization_id, role, status")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (membershipError) { reportServerError("viewer.membership", membershipError); throw new Error("Workspace access could not be verified. Please try again."); }
  if (!membership) {
    const {data: ownerAccess, error: ownerError} = await supabase.rpc("platform_access");
    if (ownerError) { reportServerError("viewer.platform", ownerError); throw new Error("Account access could not be verified. Please try again."); }
    if (ownerAccess && ownerAccess !== "none") redirect("/platform");
    redirect("/account/unassigned");
  }
  if (membership.status !== "active") redirect("/account/inactive");

  const [{ data: organization, error: organizationError }, { data: profile, error: profileError }, {data: usagePreference, error: usageError}] = await Promise.all([
    supabase.from("organizations").select("name, timezone").eq("id", membership.organization_id).single(),
    supabase.from("profiles").select("display_name, avatar_path, timezone").eq("organization_id", membership.organization_id).eq("user_id", userId).maybeSingle(),
    supabase.from("product_usage_preferences").select("enabled").eq("user_id", userId).maybeSingle(),
  ]);

  if (organizationError || profileError || usageError) { reportServerError("viewer.details", organizationError || profileError || usageError); throw new Error("Workspace details could not load. Please try again."); }

  const deviceTimezone = (await cookies()).get(TIMEZONE_COOKIE)?.value;
  return {
    organizationTimezone: organization?.timezone ?? "UTC",
    timezonePreference: profile?.timezone ?? null,
    timeZone: resolveTimezone(profile?.timezone, deviceTimezone, organization?.timezone),
    id: userId,
    email: typeof claims.claims.email === "string" ? claims.claims.email : "",
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "Organization",
    displayName: profile?.display_name ?? (typeof claims.claims.email === "string" ? claims.claims.email : "User"),
    avatarPath: profile?.avatar_path ?? null,
    role: membership.role,
    status: membership.status,
    usageSharing: usagePreference?.enabled === true,
  };
});

/** Request-scoped and presentation-only: storage must never delay authorization. */
export const requireViewerAvatarUrl = cache(async (): Promise<string | null> => {
  const viewer = await requireViewer();
  if (!viewer.avatarPath) return null;
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.storage.from("profile-photos").createSignedUrl(viewer.avatarPath, 3600);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    // A profile-photo outage should leave the initials, not break the workspace.
    return null;
  }
});
