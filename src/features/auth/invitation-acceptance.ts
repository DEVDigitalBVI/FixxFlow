import 'server-only';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import { isObjectRecord } from '@/lib/validation';

import { invitationTokenHash } from './invitation-token';

// GET only displays a confirmation. Mail scanners cannot consume an invitation.
export async function acceptWorkspaceInvitation(
  id: string,
  token: string,
  admin: ReturnType<typeof createAdminClient>,
  session: Awaited<ReturnType<typeof createClient>>,
): Promise<ActionResult> {
  if (!isUuid(id) || !/^[a-f0-9]{64}$/.test(token))
    return { error: 'This invitation is invalid. Ask your administrator for a new invitation.' };
  const claim = randomUUID();
  const { data, error } = await admin.rpc('claim_workspace_invitation', {
    invitation: id,
    hash: invitationTokenHash(token),
    claim,
  });
  if (
    error ||
    !isObjectRecord(data) ||
    typeof data.email !== 'string' ||
    typeof data.userId !== 'string'
  )
    return {
      error:
        error?.code === 'PT429'
          ? 'Acceptance is already in progress. Try again in two minutes.'
          : 'This invitation has expired, has already been accepted, or is no longer available. Sign in, reset your password, or ask your administrator for a new invitation.',
    };
  let verified = false;
  try {
    // Generate a fresh, short-lived Auth token only after the 72-hour link is claimed.
    // Invite generation rejects accounts that are already confirmed; an old invitation
    // must never become a recovery credential for an established account.
    const generated = await admin.auth.admin.generateLink({ type: 'invite', email: data.email });
    if (
      generated.error ||
      generated.data.user?.id !== data.userId ||
      !generated.data.properties?.hashed_token
    )
      throw Error();
    const result = await session.auth.verifyOtp({
      type: 'invite',
      token_hash: generated.data.properties.hashed_token,
    });
    if (result.error || result.data.user?.id !== data.userId) throw Error();
    verified = true;
    return { redirectTo: '/auth/update-password' };
  } catch {
    return {
      error: 'Account setup could not be confirmed. Your invitation is preserved; try again.',
    };
  } finally {
    try {
      const finished = await admin.rpc('finish_workspace_invitation', {
        invitation: id,
        claim,
        success: verified,
      });
      if (finished.error) reportServerError('invitation.finalize', finished.error);
    } catch (error) {
      reportServerError('invitation.finalize', error);
    }
  }
}
