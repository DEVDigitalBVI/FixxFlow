import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { inventoryAccess } from './access';
import { contextLabel, inventoryStates } from './model';
import { ReviewForm, IssueForm } from './forms';
export async function InventoryRequestPanel({ ticketId }: { ticketId: string }) {
 const viewer = await requireViewer(); const db = await createClient();
 const { data: request, error } = await db.from('inventory_requests').select('*').eq('organization_id',viewer.organizationId).eq('ticket_id',ticketId).maybeSingle();
 if (error) return <section className="settings-card"><h2>Inventory fulfillment</h2><p role="alert">Inventory progress could not load. Reload to try again.</p></section>;
 if (!request) return null;
 const access = await inventoryAccess(viewer);
 const units = access.manager && request.state === 'approved' ? await db.from('inventory_equipment').select('*').eq('organization_id',viewer.organizationId).eq('request_id',request.id).eq('state','reserved').order('asset_id') : { data: [], error: null };
 const final = ['issued','cancelled','declined'].includes(request.state);
 const status = inventoryStates[request.state];
 return <section className="settings-card stack" aria-labelledby="inventory-fulfillment"><h2 id="inventory-fulfillment">Inventory request</h2>
  <p><span className={`ticket-badge tone-${status.tone}`}>{status.label}</span></p>
  <p><strong>{contextLabel(request.context,'item')}</strong> · Quantity {request.quantity} · {contextLabel(request.context,'department')}</p>
  <p>Requested by {contextLabel(request.context,'requester')}. For {contextLabel(request.context,'recipient') || 'departmental use'} · {request.destination}</p>
  {contextLabel(request.context,'printer') && <p>Printer: {contextLabel(request.context,'printer')}</p>}
  {request.decision_reason && <p>Review note: {request.decision_reason}</p>}
  {request.issued_at && <p>Issued {new Date(request.issued_at).toLocaleString('en-US')}</p>}
  <p className="muted">Closing an unfinished ticket cancels fulfillment and releases stock. Reopening continues the conversation without reserving or issuing again.</p>
  {access.manager && <Link className="button button-secondary" href={`/app/inventory/${request.item_id}`}>View inventory and usage history</Link>}
  {access.manager && !final && <>
   {request.state !== 'approved' && <details><summary className="button button-secondary">Review approval</summary><ReviewForm request={request} equipment={contextLabel(request.context,'kind')==='equipment'} command="approve" token={randomUUID()}/></details>}
   {request.state === 'approved' && (units.error ? <p role="alert">Reserved equipment could not load. Reload before handing over.</p> : <IssueForm request={request} units={units.data ?? []} token={randomUUID()}/>)}
   <details><summary className="button button-secondary">Ask for more information</summary><ReviewForm request={request} equipment={false} command="information" token={randomUUID()}/></details>
   <details><summary className="button button-secondary">Decline request</summary><ReviewForm request={request} equipment={false} command="decline" token={randomUUID()}/></details>
  </>}
  {!final && (access.manager || (request.requester_id===viewer.id && access.departments.includes(request.department_id))) && <details><summary className="button button-secondary">Cancel inventory request</summary><ReviewForm request={request} equipment={false} command="cancel" token={randomUUID()}/></details>}
  {final && <p className="muted">Fulfillment is final. Submit a new inventory request if more items are needed.</p>}
 </section>;
}
