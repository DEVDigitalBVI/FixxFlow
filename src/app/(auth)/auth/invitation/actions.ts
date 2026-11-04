'use server';

import { acceptWorkspaceInvitation } from '@/features/auth/invitation-acceptance';
import type { ActionResult } from '@/lib/action-result';
import { formString } from '@/lib/form-data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function acceptInvitation(form: FormData): Promise<ActionResult> {
  return acceptWorkspaceInvitation(
    formString(form, 'id', ''),
    formString(form, 'token', ''),
    createAdminClient(),
    await createClient(),
  );
}
