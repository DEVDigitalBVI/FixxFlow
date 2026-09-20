function requiredPublicEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseEnvironment() {
  return {
    url: requiredPublicEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: requiredPublicEnvironmentVariable(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}
