'use server';

import type { ActionResult } from '@/lib/action-result';
import { formString } from '@/lib/form-data';
import { createClient } from '@/lib/supabase/server';

export async function continuePasswordRecovery(form: FormData): Promise<ActionResult> {
  const hash = formString(form, 'token_hash', '');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(hash))
    return { error: 'This reset link is invalid. Request a new password-reset email.' };
  const db = await createClient();
  const { error } = await db.auth.verifyOtp({ token_hash: hash, type: 'recovery' });
  if (error)
    return {
      error:
        'This reset link has expired or has already been used. Request a new password-reset email and open the newest link.',
    };
  return { redirectTo: '/auth/update-password' };
}
