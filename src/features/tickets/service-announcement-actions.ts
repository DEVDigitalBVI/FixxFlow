'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

export async function manageServiceAnnouncement(
  form: FormData,
): Promise<{ error?: string; success?: string; revision?: number }> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can publish announcements.' };
  const ticket = formString(form, 'ticketId', ''),
    operation = formString(form, 'operation', ''),
    revision = Number(form.get('revision')),
    requestKey = formString(form, 'requestKey', '');
  if (
    !isUuid(ticket) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !['publish', 'withdraw'].includes(operation) ||
    (operation === 'publish' && !isUuid(requestKey))
  )
    return { error: 'Reload the announcement before saving.' };
  const title = formString(form, 'title', '').trim(),
    body = formString(form, 'body', '').trim();
  if (
    operation === 'publish' &&
    (title.length < 3 || title.length > 180 || body.length < 3 || body.length > 3000)
  )
    return { error: 'Enter a title (3–180 characters) and message (3–3,000 characters).' };
  const db = await createClient();
  const { data, error } =
    operation === 'publish'
      ? await db.rpc('publish_employee_announcement', {
          org: viewer.organizationId,
          ticket,
          expected_revision: revision,
          heading: title,
          message: body,
          request_key: requestKey,
        })
      : await db.rpc('manage_service_announcement', {
          org: viewer.organizationId,
          ticket,
          expected_revision: revision,
          operation: 'withdraw',
          payload: {},
        });
  if (error) {
    reportServerError('incident.save', error);
    return {
      error:
        error.code === 'PT409'
          ? 'The announcement changed. Your text is preserved. Review the latest announcement before trying again.'
          : 'The announcement could not be saved. Only the assigned technician, coordinator or an administrator can publish or remove it. Check that the ticket is active. Your text is preserved.',
    };
  }
  for (const path of [
    '/app',
    '/app/service-status',
    '/app/tickets/new',
    '/app/notifications',
    `/app/tickets/${ticket}`,
  ])
    revalidatePath(path);
  const result = operation === 'publish' ? (data as { revision?: Json; recipients?: Json }) : null;
  return {
    revision: result ? Number(result.revision) : Number(data),
    success: result
      ? `Announcement published. Email queued for ${Number(result.recipients)} active members.`
      : 'Announcement removed from home pages. Emails already sent cannot be recalled.',
  };
}
