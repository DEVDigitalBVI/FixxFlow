import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import type { Viewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { isInsightAccess, type InsightAccess } from './model';

const loadAccess = cache(async (org: string): Promise<InsightAccess> => {
  const db = await createClient();
  const { data, error } = await db.rpc('support_viewer_access', { org });
  if (error || !isInsightAccess(data))
    throw new Error('Support insight access could not be verified. Please try again.');
  return data;
});
export function supportViewerAccess(viewer: Viewer) {
  return loadAccess(viewer.organizationId);
}
export async function requireInsightAccess(viewer: Viewer, capability: keyof InsightAccess) {
  const access = await supportViewerAccess(viewer);
  if (!access[capability]) notFound();
  return access;
}
