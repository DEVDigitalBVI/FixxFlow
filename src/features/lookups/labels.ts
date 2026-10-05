import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { reportServerError } from '@/lib/server-errors';

/** Display-only records for the current page, including inactive historical authors. */
export async function profileLabels(db: SupabaseClient<Database>, org: string, values: (string | null | undefined)[]) {
  const ids = [...new Set(values.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  if (ids.length > 200) throw new Error('Too many display references');
  const { data, error } = await db.from('profiles').select('user_id, display_name').eq('organization_id', org).in('user_id', ids);
  if (error) { reportServerError('ticket.references', error); throw new Error('Names could not load. Please try again.'); }
  return data ?? [];
}
