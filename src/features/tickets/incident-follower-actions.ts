'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

export async function manageIncidentFollower(form: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can manage incident followers.' };
  const ticket = formString(form, 'ticketId', ''),
    person = formString(form, 'userId', ''),
    operation = formString(form, 'operation', ''),
    expected_revision = Number(form.get('revision'));
  if (
    !isUuid(ticket) ||
    !isUuid(person) ||
    !form.has('revision') ||
    !Number.isSafeInteger(expected_revision) ||
    expected_revision < 0 ||
    !['add', 'remove'].includes(operation)
  )
    return { error: 'Choose a workspace member and reload the latest follower list.' };
  if (form.has('lookupLoadError'))
    return {
      error: 'Retry the member search before adding a follower. Your selection is preserved.',
    };
  const db = await createClient();
  const { error } = await db.rpc('manage_incident_follower', {
    org: viewer.organizationId,
    ticket,
    person,
    expected_revision,
    operation,
  });
  if (error?.code === 'PT409')
    return {
      error: 'The follower list changed. Reload this ticket, review the list and try again.',
    };
  if (error)
    return {
      error:
        'The follower could not be updated. Check that this is an incident and the member is active, then try again.',
    };
  revalidatePath(`/app/tickets/${ticket}`);
  return {
    success:
      operation === 'add'
        ? 'Follower added for approved incident updates. Prepare and send the next update in Coordinate.'
        : 'Follower removed from future update drafts. Already approved updates are retained.',
  };
}
