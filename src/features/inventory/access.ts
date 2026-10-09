import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Viewer } from '@/lib/auth/viewer';
export async function inventoryAccess(viewer: Viewer) {
 const db = await createClient();
 const [managers, requesters] = await Promise.all([
  db.from('inventory_managers').select('user_id').eq('organization_id', viewer.organizationId).eq('user_id', viewer.id).maybeSingle(),
  db.from('inventory_requesters').select('department_id').eq('organization_id', viewer.organizationId).eq('user_id', viewer.id),
 ]);
 if (managers.error || requesters.error) throw new Error('Inventory access could not be verified. Try again.');
 return { manager: Boolean(managers.data), departments: (requesters.data ?? []).map(r => r.department_id) };
}
