'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

import { parseStep } from './response-checklist';

export async function changeStep(
  form: FormData,
): Promise<{ error?: string; success?: string; revision?: number }> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can coordinate response steps.' };
  const ticket = formString(form, 'ticketId', ''),
    step = formString(form, 'stepId', ''),
    operation = formString(form, 'operation', '');
  const revision = Number(form.get('revision'));
  if (
    ![ticket, step].every((v) => isUuid(v)) ||
    !['add', 'edit', 'acknowledge', 'complete', 'reopen'].includes(operation) ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return { error: 'Reload the latest checklist before saving.' };
  if (form.has('lookupLoadError'))
    return { error: 'Retry the assignee lookup before saving. Your draft is preserved.' };
  const parsed = ['add', 'edit'].includes(operation) ? parseStep(form) : { data: {} };
  if ('error' in parsed && parsed.error) return { error: parsed.error };
  const db = await createClient();
  const { data, error } = await db.rpc('change_incident_step', {
    org: viewer.organizationId,
    ticket,
    step,
    expected_revision: revision,
    operation,
    payload: parsed.data!,
  });
  if (error?.code === 'PT422')
    return {
      error:
        'Approval is required for the current step details. Open Approvals and decisions to request or review it before completing this step.',
    };
  if (error?.code === 'PT409')
    return {
      error:
        'This step changed. Your draft is preserved. Review the latest checklist in a new tab, then reload before trying again.',
    };
  if (error || data === null) {
    reportServerError('incident.save', error);
    return {
      error:
        'The step could not be saved. Check that the assignee is active and the action is still available, then try again. Your draft is preserved.',
    };
  }
  revalidatePath(`/app/tickets/${ticket}`);
  revalidatePath('/app/tickets');
  return {
    success: operation === 'add' ? 'Response step added.' : 'Response step updated.',
    revision: data,
  };
}

export async function olderStepHistory(ticket: string, before: number) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || !isUuid(ticket) || !Number.isSafeInteger(before) || before < 1)
    return { error: 'Response history is unavailable.' };
  const db = await createClient();
  const { data, error } = await db
    .from('incident_step_history')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticket)
    .lt('id', before)
    .order('id', { ascending: false })
    .limit(51);
  if (error) {
    reportServerError('incident.save', error);
    return { error: 'Earlier history could not load. Try again.' };
  }
  const rows = (data ?? []).slice(0, 50);
  try {
    const { profileLabels } = await import('@/features/lookups/labels');
    const profiles = await profileLabels(
      db,
      viewer.organizationId,
      rows.flatMap((row) => [row.actor_id, row.snapshot.assignee_id]),
    );
    return {
      rows,
      hasMore: (data?.length ?? 0) > 50,
      names: Object.fromEntries(profiles.map((p) => [p.user_id, p.display_name])),
    };
  } catch {
    return { error: 'Staff names could not load. Try again.' };
  }
}
