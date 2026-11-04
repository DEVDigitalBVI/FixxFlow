'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

export async function saveInsightAccess(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can change insight access.' };
  const member = formString(form, 'userId', '');
  const revision = Number(form.get('revision'));
  if (!isUuid(member) || !Number.isInteger(revision) || revision < 0)
    return { error: 'Reload this member before saving access.' };
  const db = await createClient();
  const { error } = await db.rpc('set_support_viewer_access', {
    org: viewer.organizationId,
    member,
    dashboard: form.get('dashboard') === 'on',
    shared_incidents: form.get('sharedIncidents') === 'on',
    expected_revision: revision,
  });
  if (error)
    return {
      error:
        error.code === '40001'
          ? 'Access changed. Reload before saving again.'
          : 'Access could not be confirmed. Your choices are preserved; reload to check or retry.',
    };
  revalidatePath('/app', 'layout');
  return { success: 'Employee insight access saved.' };
}
export async function saveSharedIncident(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can publish incident summaries.' };
  const ticket = formString(form, 'ticketId', '');
  const revision = Number(form.get('revision'));
  const title = formString(form, 'title', '').trim(),
    overview = formString(form, 'overview', '').trim(),
    resolution = formString(form, 'resolution', '').trim();
  if (!isUuid(ticket) || !Number.isInteger(revision) || revision < 0)
    return { error: 'Reload this ticket before saving.' };
  if (
    !title ||
    title.length > 200 ||
    !overview ||
    overview.length > 4000 ||
    resolution.length > 4000
  )
    return {
      error:
        'Enter a title up to 200 characters, an overview up to 4,000, and a resolution summary up to 4,000.',
    };
  const db = await createClient();
  const { error } = await db.rpc('save_shared_incident', {
    org: viewer.organizationId,
    ticket,
    title,
    overview,
    resolution,
    published: form.get('published') === 'on',
    expected_revision: revision,
  });
  if (error)
    return {
      error:
        error.code === '40001'
          ? 'This summary changed. Reload before saving again.'
          : error.code === '22023'
            ? 'Only incidents and High/Urgent tickets can be shared. Review the ticket and retry.'
            : 'The summary could not be confirmed. Your entries are preserved; reload to check or retry.',
    };
  revalidatePath('/app/shared-incidents');
  revalidatePath(`/app/shared-incidents/${ticket}`);
  revalidatePath(`/app/tickets/${ticket}`);
  return { success: 'Shared incident summary saved.' };
}
