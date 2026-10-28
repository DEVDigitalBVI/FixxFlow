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
    .select('email')
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
  const known = new Set((existing.data ?? []).map((row) => row.email?.toLowerCase()));
  const results = [];
  for (const row of rows) {
    if (known.has(row.email)) {
      results.push({
        token: row.token,
        success: 'Already a member; role and access were not changed.',
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
  }
  return { rows: results };
}
