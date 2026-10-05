import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function requireAssurance(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data?.currentLevel) redirect("/login?error=Could%20not%20verify%20your%20session.%20Please%20sign%20in%20again.");
  if (data.currentLevel === "aal1" && data.nextLevel === "aal2") redirect("/auth/mfa");
}
