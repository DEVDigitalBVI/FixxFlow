'use server';

import { revalidatePath } from 'next/cache';

import {
  queueViewQuery,
  SAVED_VIEW_LIMIT,
  SAVED_VIEW_NAME_LENGTH,
} from '@/features/tickets/queue-views';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

export async function saveQueueView(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can save queue views.' };
  const name = formString(form, 'name', '').trim();
  if (!name || name.length > SAVED_VIEW_NAME_LENGTH)
    return { error: `Enter a name of up to ${SAVED_VIEW_NAME_LENGTH} characters.` };
  // Re-derive the query on the server so only known queue parameters are stored.
  const query = queueViewQuery(new URLSearchParams(formString(form, 'query', '')));
  const supabase = await createClient();
  const { error } = await supabase
    .from('saved_queue_views')
    .insert({ organization_id: viewer.organizationId, user_id: viewer.id, name, query });
  if (error?.code === '23505') return { error: 'You already have a view with this name.' };
  if (error?.code === '23514') return { error: `You can save up to ${SAVED_VIEW_LIMIT} views.` };
  if (error) return { error: 'The view could not be saved. Try again.' };
  revalidatePath('/app/tickets');
  return { success: `Saved view “${name}”.` };
}

export async function deleteQueueView(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can manage queue views.' };
  const id = formString(form, 'id', '');
  if (!isUuid(id)) return { error: 'Reload the page and try again.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('saved_queue_views')
    .delete()
    .eq('organization_id', viewer.organizationId)
    .eq('user_id', viewer.id)
    .eq('id', id);
  if (error) return { error: 'The view could not be deleted. Try again.' };
  revalidatePath('/app/tickets');
  return { success: 'Saved view deleted.' };
}
