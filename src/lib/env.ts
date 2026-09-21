export function getSupabaseEnvironment() {
  // Next.js replaces direct NEXT_PUBLIC_ references in client bundles at build time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return {
    url,
    publishableKey,
  };
}
