'use server';
import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { validTimezone } from './model';
export async function saveTimezone(data: FormData) {
  const viewer = await requireViewer();
  const scope = String(data.get('scope'));
  if (scope !== 'personal' && scope !== 'organization') return { error: 'Choose which timezone to update.' };
  if (scope === 'organization' && viewer.role !== 'administrator') return { error: 'Administrator access is required.' };
  const timezone = String(data.get('timezone') ?? '').trim();
  if (!(scope === 'personal' && !timezone) && !validTimezone(timezone)) return { error: 'Choose a valid named timezone.' };
  const expected = String(data.get('expectedTimezone') ?? '');
  const db = await createClient();
  let query = scope === 'organization'
    ? db.from('organizations').update({ timezone }).eq('id', viewer.organizationId).eq('timezone', expected)
    : db.from('profiles').update({ timezone: timezone || null }).eq('organization_id', viewer.organizationId).eq('user_id', viewer.id);
  if (scope === 'personal') query = expected ? query.eq('timezone', expected) : query.is('timezone', null);
  const { data: saved, error } = await query.select('timezone').maybeSingle();
  if (error || !saved) return { error: 'The timezone could not be saved or was changed elsewhere. Your selection is preserved. Reload to check the saved setting.' };
  revalidatePath('/app', 'layout');
  return { success: 'Timezone saved.' };
}
