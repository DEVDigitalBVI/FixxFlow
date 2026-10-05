import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnvironment } from "@/lib/env";
import type { Database } from "@/types/database";

export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");

  return createSupabaseClient<Database>(getSupabaseEnvironment().url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
