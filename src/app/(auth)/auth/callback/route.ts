import { recordCompletedLogin } from "@/features/product-analytics/actions";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth/safe-redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
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
