import 'server-only';

import { cache } from 'react';

import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

async function staffDatabase(organizationId: string) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || viewer.organizationId !== organizationId)
    throw new Error('Ticket staff access required.');
  return createClient();
}
/** React cache is request-local; primitive keys share results across server panels only. */
export const loadTicketWorkflow = cache(async (organizationId: string, ticketId: string) => {
  const db = await staffDatabase(organizationId);
  return db
    .from('ticket_workflows')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('ticket_id', ticketId)
    .maybeSingle();
});
export const loadTicketFiles = cache(async (organizationId: string, ticketId: string) => {
  const db = await staffDatabase(organizationId);
  return db
    .from('ticket_attachments')
    .select('id, file_name, storage_path, size_bytes, created_at, is_internal')
    .eq('organization_id', organizationId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE);
});
