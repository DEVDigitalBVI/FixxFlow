import { recordCompletedLogin } from "@/features/product-analytics/actions";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth/safe-redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHashes = url.searchParams.getAll("token_hash");
  if (!code && tokenHashes.length === 1 && tokenHashes[0] && url.searchParams.get("type") === "invite") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHashes[0], type: "invite" });
    if (!error) {
      // Invitations have no browser PKCE verifier. Establish the SSR session
      // directly and always finish account setup before entering the workspace.
      return NextResponse.redirect(new URL("/auth/update-password", url.origin));
    }
  }
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const target = safeAuthRedirect(url.searchParams.get("next"), url.origin);
      if (target.pathname !== "/auth/update-password") await recordCompletedLogin();
      return NextResponse.redirect(target);
    }
  }
  const target = new URL("/login", url.origin);
  target.searchParams.set("error", "This authentication link is invalid or has expired.");
  return NextResponse.redirect(target);
}
