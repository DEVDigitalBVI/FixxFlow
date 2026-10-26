'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

export async function manageServiceAnnouncement(form: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can prepare announcements.' };
  const ticket = formString(form, 'ticketId', ''),
    operation = formString(form, 'operation', ''),
    revision = Number(form.get('revision'));
  if (
    !isUuid(ticket) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !['save', 'publish', 'withdraw'].includes(operation)
  )
    return { error: 'Reload the announcement before saving.' };
  const title = formString(form, 'title', '').trim(),
    body = formString(form, 'body', '').trim();
  if (
    operation === 'save' &&
    (title.length < 3 || title.length > 180 || body.length < 3 || body.length > 3000)
  )
    return { error: 'Enter a title (3–180 characters) and message (3–3,000 characters).' };
  if (operation === 'publish' && form.get('confirm') !== 'yes')
    return { error: 'Review the saved message and confirm its workspace-wide audience.' };
  const db = await createClient();
  const { data, error } = await db.rpc('manage_service_announcement', {
    org: viewer.organizationId,
    ticket,
    expected_revision: revision,
    operation,
    payload: { title, body, confirm: form.get('confirm') === 'yes' ? 'yes' : 'no' },
  });
  if (error) {
    reportServerError('incident.save', error);
    return {
      error:
        error.code === 'PT409'
          ? 'The saved draft changed. Your text is preserved. Review the latest announcement in a new tab before trying again.'
          : 'The announcement could not be saved. Check the ticket is active. Only its coordinator or an administrator can publish or remove notices. Your draft is preserved.',
    };
  }
  for (const path of ['/app', '/app/service-status', '/app/tickets/new', `/app/tickets/${ticket}`])
    revalidatePath(path);
  return {
    revision: data!,
    success:
      operation === 'save'
        ? 'Draft saved. Review it before publishing.'
        : operation === 'publish'
          ? 'Announcement published to the workspace.'
          : 'Announcement removed from employee pages.',
  };
}
