import 'server-only';

import type { Viewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export type QueueCounts = Record<'mine' | 'unassigned' | 'overdue' | 'chats', number | null>;
export async function loadQueueCounts(
  viewer: Pick<Viewer, 'id' | 'organizationId' | 'role'>,
): Promise<QueueCounts> {
  const empty: QueueCounts = { mine: null, unassigned: null, overdue: null, chats: null };
  if (viewer.role === 'end_user') return empty;
  try {
    const db = await createClient(),
      active = ['new', 'open', 'in_progress', 'waiting_on_user', 'on_hold'] as const;
    const tickets = () =>
      db
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', viewer.organizationId)
        .in('status', [...active]);
    const results = await Promise.allSettled([
      tickets().eq('assigned_technician_id', viewer.id),
      tickets().is('assigned_technician_id', null),
      tickets().lte('sla_next_due_at', new Date().toISOString()),
      db
        .from('chat_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', viewer.organizationId)
        .eq('status', 'open')
        .is('assigned_technician_id', null),
    ]);
    const keys = ['mine', 'unassigned', 'overdue', 'chats'] as const;
    results.forEach((result, index) => {
      if (
        result.status === 'fulfilled' &&
        !result.value.error &&
        typeof result.value.count === 'number'
      )
        empty[keys[index]] = result.value.count;
    });
    return empty;
  } catch {
    return empty;
  }
}
