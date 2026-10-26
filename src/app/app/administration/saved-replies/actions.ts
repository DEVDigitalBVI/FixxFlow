'use server';

import { revalidatePath } from 'next/cache';

import { validateSavedReply } from '@/features/tickets/saved-replies';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

const PATH = '/app/administration/saved-replies';

export async function saveSavedReply(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can manage saved replies.' };
  const id = formString(form, 'id', '');
  const title = formString(form, 'title', '').trim();
  const body = formString(form, 'body', '');
  const invalid = validateSavedReply(title, body);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  if (!id) {
    const { error } = await supabase
      .from('saved_replies')
      .insert({ organization_id: viewer.organizationId, created_by: viewer.id, title, body });
    if (error)
      return {
        error:
          error.code === '23505'
            ? 'A saved reply with this title already exists. Choose a different title.'
            : 'The saved reply could not be created. Your text is still here; try again.',
      };
    revalidatePath(PATH);
    return { success: 'Saved reply created.' };
  }
  const revision = Number(formString(form, 'revision', ''));
  if (!isUuid(id) || !Number.isInteger(revision))
    return { error: 'Reload the page and try again.' };
  // Row-level security limits edits to the author or an administrator; the
  // revision check prevents overwriting someone else's newer change.
  const { data, error } = await supabase
    .from('saved_replies')
    .update({ title, body })
    .eq('organization_id', viewer.organizationId)
    .eq('id', id)
    .eq('revision', revision)
    .select('id')
    .maybeSingle();
  if (error)
    return {
      error:
        error.code === '23505'
          ? 'A saved reply with this title already exists. Choose a different title.'
          : 'The saved reply could not be saved. Your changes are still here; try again.',
    };
  if (!data)
    return {
      error:
        'Not saved. This reply changed since you opened it, or only its author or an administrator can edit it. Reload to see the latest version.',
    };
  revalidatePath(PATH);
  return { success: 'Saved reply updated.' };
}

export async function deleteSavedReply(form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can manage saved replies.' };
  const id = formString(form, 'id', '');
  if (!isUuid(id)) return { error: 'Reload the page and try again.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('saved_replies')
    .delete()
    .eq('organization_id', viewer.organizationId)
    .eq('id', id)
    .select('id');
  if (error) return { error: 'The saved reply could not be deleted. Try again.' };
  if (!data?.length)
    return { error: 'Only its author or an administrator can delete this saved reply.' };
  revalidatePath(PATH);
  return { success: 'Saved reply deleted.' };
}
