'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

import { cleanupMessage, isCleanupResult } from './retention-model';

export async function runAnalyticsCleanup(): Promise<ActionResult> {
  await requirePlatformOwner();
  const db = await createClient();
  const { data, error } = await db.rpc('platform_product_usage_cleanup');
  if (error || !isCleanupResult(data)) {
    const reference = reportServerError('platform.analytics.cleanup', error ?? 'Unexpected result');
    return { error: `Cleanup could not run. Try again shortly. Reference: ${reference}` };
  }
  revalidatePath('/platform/analytics');
  revalidatePath('/platform/audit');
  return { success: cleanupMessage(data) };
}
