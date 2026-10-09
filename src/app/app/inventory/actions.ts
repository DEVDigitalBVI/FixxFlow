'use server';
import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { inventoryAccess } from '@/features/inventory/access';
import { quantity } from '@/features/inventory/model';
import type { ActionResult } from '@/lib/action-result';
import type { Json } from '@/types/database';
import { reportServerError } from '@/lib/server-errors';

export async function inventoryMutation(form: FormData): Promise<ActionResult> {
 const viewer = await requireViewer();
 const command = String(form.get('command') ?? '');
 if (!['create','receive','correct','request','approve','decline','information','cancel','issue','permissions'].includes(command)) return { error: 'Choose an inventory action.' };
 const access = await inventoryAccess(viewer);
 if (command === 'permissions' ? viewer.role !== 'administrator' : !['request','cancel'].includes(command) && !access.manager) return { error: 'You do not have permission for this inventory action.' };
 if (command === 'request' && !access.departments.length) return { error: 'Request permission is required for a department.' };
 if (form.has('lookupLoadError')) return { error: 'Choices could not load. Your entries are preserved; retry the lookup before saving.' };
 const token = String(form.get('token') ?? '');
 if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: 'The retry key is unavailable. Reload before submitting.' };
 const payload: Record<string, Json> = {};
 for (const key of ['id','name','kind','department','location','recipient','destination','printer','reason','note']) if (form.has(key)) payload[key] = String(form.get(key) ?? '').trim();
 if (['receive','correct','request'].includes(command)) {
  const value = quantity(form.get('quantity'), command === 'correct');
  if (value === null) return { error: command === 'correct' ? 'Use a nonzero whole quantity for the correction.' : 'Enter a positive whole quantity.' };
  payload.quantity = value;
 }
 payload.assets = form.getAll('assets').map(String).filter(Boolean);
 if (command === 'permissions') { payload.departments = form.getAll('departments').map(String); payload.manager = form.get('manager') === 'on'; }
 const db = await createClient();
 const { data, error } = await db.rpc('inventory_command', { org: viewer.organizationId, command, token, payload });
 if (error || !data) {
  if (error) reportServerError('inventory.mutation', error);
  const safe = /^(Insufficient available stock|Correction would|Choose |Equipment |Only unreserved|Confirm |Approve and reserve|This request|This fulfillment|A reason|Recipient |Department is inactive|Reopen the conversation|Retry key already|Request permission|Inventory manager permission|Inventory access denied|Use a whole|Select exactly|Manage stored)/;
  return { error: error && safe.test(error.message) ? error.message : 'Inventory could not be saved. Check your permissions and entries, then retry. Your draft is preserved.' };
 }
 revalidatePath('/app/inventory'); revalidatePath('/app/people'); revalidatePath('/app/tickets');
 if (command === 'request') {
  const { data: request } = await db.from('inventory_requests').select('ticket_id').eq('organization_id', viewer.organizationId).eq('id', data).single();
  return request ? { redirectTo: `/app/tickets/${request.ticket_id}?success=Inventory+request+submitted` } : { success: 'Request submitted. Open request history to continue.' };
 }
 if (command === 'create') return { redirectTo: `/app/inventory/${data}` };
 if (['receive','correct'].includes(command)) revalidatePath(`/app/inventory/${data}`);
 else if (command !== 'permissions') {
  const { data: request } = await db.from('inventory_requests').select('ticket_id,item_id').eq('organization_id', viewer.organizationId).eq('id', data).single();
  if (request) { revalidatePath(`/app/tickets/${request.ticket_id}`); revalidatePath(`/app/inventory/${request.item_id}`); }
 }
 const messages: Record<string, string> = { receive: 'Stock received and recorded.', correct: 'Stock correction recorded.', approve: 'Approved. Stock is reserved until handover or cancellation.', issue: 'Items issued. The request is fulfilled.', decline: 'Request declined. Any reservation was released.', cancel: 'Request cancelled. Any reservation was released.', information: 'Question sent in the conversation. Any reservation was released.', permissions: 'Inventory permissions saved.' };
 return { success: messages[command] ?? 'Inventory saved.' };
}
