'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { parseNotificationPreferences } from '@/features/notifications/preferences-model';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export async function saveNotificationPreferences(
  data: FormData,
): Promise<ActionResult & { revision?: number }> {
  const viewer = await requireViewer();
  const settings = parseNotificationPreferences(data);
  const revision = Number(data.get('revision') ?? NaN);
  if (!settings || !Number.isSafeInteger(revision) || revision < 0)
    return {
      error:
        'Check your email frequency, timezone and times. Quiet hours must start and end at different times.',
    };
  try {
    const db = await createClient();
    const result = await db.rpc('save_notification_preferences', {
      org: viewer.organizationId,
      expected_revision: revision,
      settings,
    });
    if (result.error)
      return {
        error:
          result.error.code === '40001'
            ? 'Your preferences changed in another tab. Reload this page before saving.'
            : 'Preferences could not be saved. Your changes are still here; try again.',
      };
    revalidatePath('/app/notifications/settings');
    return { success: 'Notification preferences saved.', revision: result.data };
  } catch (error) {
    unstable_rethrow(error);
    return { error: 'Preferences could not be saved. Your changes are still here; try again.' };
  }
}
