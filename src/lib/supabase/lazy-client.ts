import type { createClient } from '@/lib/supabase/client';

type BrowserClient = ReturnType<typeof createClient>;
let pending: Promise<BrowserClient> | null = null;

/**
 * Loads the Supabase browser SDK on first use, keeping it out of the initial
 * bundle for always-mounted UI such as the navigation's notification badge.
 * A failed load is retried on the next call.
 */
export function loadBrowserClient(): Promise<BrowserClient> {
  pending ??= import('@/lib/supabase/client')
    .then((module) => module.createClient())
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
