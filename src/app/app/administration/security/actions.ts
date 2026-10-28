'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export async function saveWorkspaceSecurity(
  form: FormData,
): Promise<ActionResult & { revision?: number }> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can change workspace protection.' };
  const revision = Number(form.get('revision') ?? NaN);
  if (!Number.isSafeInteger(revision) || revision < 0)
    return { error: 'Reload this page before saving.' };
  try {
    const db = await createClient();
    const { data, error } = await db.rpc('save_workspace_security_policy', {
      org: viewer.organizationId,
      expected_revision: revision,
      require_authenticator: form.get('require_mfa') === 'on',
    });
    if (error)
      return {
        error:
          error.code === '40001'
            ? 'This policy changed in another tab. Reload before saving.'
            : error.code === '42501'
              ? 'Verify your authenticator before changing workspace protection.'
              : 'Protection could not be saved. Your choice is preserved; try again.',
      };
    revalidatePath('/app/administration/security');
    return { success: 'Workspace protection saved.', revision: data };
  } catch (error) {
    unstable_rethrow(error);
    return { error: 'Protection could not be saved. Your choice is preserved; try again.' };
  }
}
