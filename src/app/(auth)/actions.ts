"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const value = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
function authRedirect(path: string, type: "error" | "success", message: string): never { redirect(`${path}?${new URLSearchParams({ [type]: message })}`); }

export async function signIn(formData: FormData) {
  const email = value(formData, "email"); const password = value(formData, "password");
  if (!email || !password) authRedirect("/login", "error", "Enter your email and password.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) authRedirect("/login", "error", "We could not sign you in with those details.");
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal1" && data.nextLevel === "aal2") redirect("/auth/mfa");
  redirect("/app");
}

export async function requestPasswordReset(formData: FormData) {
  const email = value(formData, "email");
  if (!email) authRedirect("/forgot-password", "error", "Enter your email address.");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  authRedirect("/forgot-password", "success", "If an account matches that email, a password reset link is on its way.");
}

export async function updatePassword(formData: FormData) {
  const password = value(formData, "password"); const confirmation = value(formData, "passwordConfirmation");
  if (password.length < 8) authRedirect("/auth/update-password", "error", "Use at least 8 characters.");
  if (password !== confirmation) authRedirect("/auth/update-password", "error", "The passwords do not match.");
  const supabase = await createClient(); const { error } = await supabase.auth.updateUser({ password });
  if (error) authRedirect("/auth/update-password", "error", "Your password could not be updated. Request a new link.");
  authRedirect("/login", "success", "Password updated. Sign in with your new password.");
}

export async function signOut() { const supabase = await createClient(); await supabase.auth.signOut(); redirect("/login"); }
