import 'server-only';

import { cache } from 'react';

import type { Viewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

// Request-scoped: the layout, page and nested panels share one lookup per render.
// Keyed by primitives so callers holding different Viewer objects still share it.
const loadInventoryAccess = cache(async (organizationId: string, userId: string) => {
  const db = await createClient();
  const [managers, requesters] = await Promise.all([
    db
      .from('inventory_managers')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
    db
      .from('inventory_requesters')
      .select('department_id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId),
  ]);
  if (managers.error || requesters.error)
    throw new Error('Inventory access could not be verified. Try again.');
  return {
    manager: Boolean(managers.data),
    departments: (requesters.data ?? []).map((r) => r.department_id),
  };
});

export function inventoryAccess(viewer: Viewer) {
  return loadInventoryAccess(viewer.organizationId, viewer.id);
}
