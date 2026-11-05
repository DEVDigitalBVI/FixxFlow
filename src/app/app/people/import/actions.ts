'use server';

import { invitationValues, type BulkInviteRow } from '@/features/administration/bulk-invite-model';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

import { inviteMember } from '../actions';

export async function sendInvitationBatch(
  input: unknown,
): Promise<{ error?: string; rows?: { token: string; success?: string; error?: string }[] }> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') return { error: 'Only administrators can invite members.' };
  if (!Array.isArray(input) || input.length < 1 || input.length > 5)
    return { error: 'Send up to five reviewed invitations at a time.' };
  const rows: BulkInviteRow[] = [];
  for (const item of input) {
    const values = invitationValues(item);
    if (
      !values ||
      typeof item.token !== 'string' ||
      !isUuid(item.token) ||
      rows.some((row) => row.email === values.email || row.token === item.token)
    )
      return { error: 'The reviewed invitations are invalid. Reload the CSV before sending.' };
    rows.push({ ...values, token: item.token });
  }
  const db = await createClient();
  const existing = await db
    .from('profiles')
    .select('email, user_id')
    .eq('organization_id', viewer.organizationId)
    .in(
      'email',
      rows.map((row) => row.email),
    );
  if (existing.error)
    return {
      error:
        'Existing members could not be checked. No invitations were sent in this group; try again.',
    };
  const profiles = existing.data ?? [];
  const members = profiles.length
    ? await db
        .from('organization_memberships')
        .select('user_id, status, deleted_at')
        .eq('organization_id', viewer.organizationId)
        .in(
          'user_id',
          profiles.map((profile) => profile.user_id),
        )
    : { data: [], error: null };
  if (members.error)
    return {
      error:
        'Member access could not be checked. No invitations were sent in this group; try again.',
    };
  const membership = new Map((members.data ?? []).map((member) => [member.user_id, member]));
  const known = new Map(profiles.map((profile) => [profile.email?.toLowerCase(), profile.user_id]));
  const results = [];
  for (const row of rows) {
    if (known.has(row.email)) {
      const member = membership.get(known.get(row.email)!);
      results.push({
        token: row.token,
        ...(member?.deleted_at
          ? { error: 'This person was deleted from this workspace. No invitation was sent.' }
          : member?.status === 'inactive'
            ? {
                error:
                  'This person is inactive. Review their access in People before inviting them.',
              }
            : member?.status === 'active'
              ? { success: 'Already a member; role and access were not changed.' }
              : {
                  error:
                    'This person’s workspace access could not be verified. No invitation was sent.',
                }),
      });
      continue;
    }
    const form = new FormData();
    form.set('email', row.email);
    form.set('displayName', row.displayName);
    form.set('role', row.role);
    form.set('submissionKey', row.token);
    const result = await inviteMember(form);
    results.push({ token: row.token, ...result });
    if (result.rateLimited) return { rows: results, error: result.error };
  }
  return { rows: results };
}
