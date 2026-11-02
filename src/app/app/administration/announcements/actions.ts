'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { startEmailAnnouncementDelivery } from '@/features/email-announcements/dispatch';
import { emailAnnouncementsPath } from '@/features/email-announcements/model';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import type { ActionResult } from '@/lib/action-result';
import { requireWorkspaceAccess } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

export async function prepareEmailAnnouncement(form: FormData): Promise<ActionResult> {
  const viewer = await requireWorkspaceAccess();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can send announcements.' };
  const token = formString(form, 'submissionKey', '');
  const heading = formString(form, 'subject', '').trim();
  const message = formString(form, 'body', '').trim();
  const audience = formString(form, 'audience', '');
  const members = form.getAll('memberIds');
  if (!isUuid(token))
    return { error: 'Reload the draft before continuing. Your entries are preserved.' };
  const fieldErrors: Record<string, string> = {};
  if (
    !['all', 'selected'].includes(audience) ||
    (audience === 'selected' &&
      (members.length < 1 ||
        members.length > 500 ||
        members.some((id) => typeof id !== 'string' || !isUuid(id)) ||
        new Set(members).size !== members.length))
  )
    fieldErrors.audience = 'Choose all registered members, or select between one and 500 members.';
  if (heading.length < 3 || heading.length > 180 || /[\r\n]/.test(heading))
    fieldErrors.subject = 'Enter a subject between 3 and 180 characters on one line.';
  if (message.length < 3 || message.length > 6000)
    fieldErrors.body = 'Enter a message between 3 and 6,000 characters.';
  if (Object.keys(fieldErrors).length)
    return { error: 'Check the subject and message.', fieldErrors };
  const db = await createClient();
  const { data, error } = await db.rpc('prepare_email_announcement', {
    org: viewer.organizationId,
    token,
    heading,
    message,
    selected_members: audience === 'selected' ? (members as string[]) : null,
  });
  if (error || !data) {
    reportServerError('email-announcement.prepare', error ?? new Error('Missing draft'));
    return {
      error:
        error?.code === 'PT422'
          ? 'Some selected members are no longer eligible, or no registered members are available. Update the recipients and try again.'
          : error?.code === 'PT409'
            ? 'This draft was already prepared with different text or recipients. Start a new announcement to change it.'
            : 'The draft could not be prepared. Your entries are preserved; try again.',
    };
  }
  revalidatePath(emailAnnouncementsPath);
  return { redirectTo: `${emailAnnouncementsPath}/${data}` };
}

export async function queueEmailAnnouncement(form: FormData): Promise<ActionResult> {
  const viewer = await requireWorkspaceAccess();
  if (viewer.role !== 'administrator')
    return { error: 'Only administrators can send announcements.' };
  const target = formString(form, 'announcementId', '');
  if (!isUuid(target) || form.get('confirm') !== 'yes')
    return { error: 'Review the message and recipients, then confirm before sending.' };
  if (!getNotificationEmailConfiguration(process.env))
    return {
      error: 'Email delivery is not configured. Contact FixxFlow support; your draft is saved.',
    };
  const db = await createClient();
  const { data, error } = await db.rpc('queue_email_announcement', {
    org: viewer.organizationId,
    target,
  });
  if (error) {
    reportServerError('email-announcement.queue', error);
    return {
      error:
        error.code === 'PT422'
          ? 'None of the reviewed members are still eligible. Prepare a new email to refresh the recipients.'
          : 'The send could not be confirmed. Your draft is saved. Retry safely; the same email will not be queued twice.',
    };
  }
  revalidatePath(emailAnnouncementsPath);
  revalidatePath(`${emailAnnouncementsPath}/${target}`);
  after(startEmailAnnouncementDelivery);
  return {
    success: `Announcement queued for ${data} members. Delivery runs in the background.`,
    redirectTo: `${emailAnnouncementsPath}/${target}?sending=1`,
  };
}
