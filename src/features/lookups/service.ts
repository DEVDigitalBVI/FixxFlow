import 'server-only';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { normalizeSearch } from '@/lib/search';
import { lookupResources, LOOKUP_PAGE_SIZE, type LookupPage, type LookupResource } from './model';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class LookupInputError extends Error {}
export async function lookupChoices(params: URLSearchParams): Promise<LookupPage> {
  const viewer = await requireViewer();
  const resource = params.get('resource') as LookupResource;
  const selected = params.get('selected') || null;
  const parent = params.get('parent') || null;
  let afterLabel: string | null = null, afterId: string | null = null;
  const cursor = params.get('cursor');
  if (!lookupResources.includes(resource) || [selected, parent].some(id => id && !uuid.test(id)) || params.getAll('selected').length > 1) throw new LookupInputError();
  if (viewer.role === 'end_user' && ['people', 'technicians', 'teams'].includes(resource)) throw new LookupInputError();
  if (cursor) {
    try {
      if (cursor.length > 4096) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || value[0].length > 600 || typeof value[1] !== 'string' || !uuid.test(value[1])) throw new Error();
      [afterLabel, afterId] = value;
    } catch { throw new LookupInputError(); }
  }
  const db = await createClient();
  const inventory = resource.startsWith('inventory_');
  const rpc = inventory ? 'inventory_choices' : 'lookup_choices';
  const base = { org: viewer.organizationId, resource, parent, active_only: params.get('active') !== 'all' };
  const [page, current] = await Promise.all([
    db.rpc(rpc, { ...base, query: normalizeSearch(params.get('q') ?? ''), after_label: afterLabel, after_id: afterId }),
    selected ? db.rpc(rpc, { ...base, selected }) : { data: [], error: null },
  ]);
  if (page.error || current.error || !page.data || !current.data) {
    throw page.error || current.error || new Error('Choices unavailable');
  }
  const rows = page.data.slice(0, LOOKUP_PAGE_SIZE);
  const last = rows.at(-1);
  return { rows, selected: current.data[0] ?? null, next: page.data.length > LOOKUP_PAGE_SIZE && last ? Buffer.from(JSON.stringify([last.label, last.id])).toString('base64url') : null };
}
