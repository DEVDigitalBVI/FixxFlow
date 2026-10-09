import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { InventoryTable } from '@/features/inventory/inventory-table';
import { CommandFields } from '@/features/inventory/forms';
import { inventoryAccess } from '@/features/inventory/access';
import { contextLabel, inventoryStates } from '@/features/inventory/model';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { pageNumber } from '@/lib/pagination';
import { inventoryMutation } from './actions';
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ department?: string; page?: string; history?: string }> }) {
 const viewer=await requireViewer(), access=await inventoryAccess(viewer), db=await createClient(), filters=await searchParams;
 const page=pageNumber(filters.page), history=pageNumber(filters.history);
 const department=/^[0-9a-f-]{36}$/i.test(filters.department ?? '') ? filters.department! : '';
 let itemsQuery=db.from('inventory_items').select('*',{count:'exact'}).eq('organization_id',viewer.organizationId);
 if (department) itemsQuery=itemsQuery.eq('department_id',department);
 let requestsQuery=db.from('inventory_requests').select('*',{count:'exact'}).eq('organization_id',viewer.organizationId);
 if (!access.manager) requestsQuery=requestsQuery.eq('requester_id',viewer.id);
 if (department) requestsQuery=requestsQuery.eq('department_id',department);
 let departmentQuery=db.from('departments').select('id,name').eq('organization_id',viewer.organizationId).eq('is_active',true).order('name');
 if (!access.manager) departmentQuery=departmentQuery.in('id',access.departments);
 const [items,requests,departments]=await Promise.all([
  itemsQuery.order('name').order('id').range((page-1)*25,page*25-1),
  requestsQuery.order('created_at',{ascending:false}).order('id').range((history-1)*25,history*25-1),
  access.manager || access.departments.length ? departmentQuery : {data:[],error:null},
 ]);
 if (departments.error) throw new Error('Departments could not load. Try again.');
 const href=(next:number,requestPage=history)=>`/app/inventory?${new URLSearchParams({department,page:String(next),history:String(requestPage)})}`;
 return <div className={viewer.role === 'end_user' && !access.manager ? 'portal-page stack' : 'page stack'}>
  <PageHeader title={access.manager ? 'Department inventory' : 'Request an item'} eyebrow={viewer.organizationName}
   description={access.manager ? 'Stock stored centrally, allocated to each department.' : 'Choose your department, then an item. Follow progress in the ticket conversation.'}
   actions={<>
    {access.manager && <Link className="button button-secondary" href="/app/tickets?kind=inventory">Review requests</Link>}
    {access.manager ? <Link className="button button-primary" href="#receive-stock">Receive stock</Link> : access.departments.length > 0 ? <Link className="button button-primary" href="#requestable-inventory">Choose an item</Link> : null}
   </>}/>
  {!access.manager && !access.departments.length && <p className="alert">You do not have inventory request permission. An administrator can grant access for your department in People. Your support access is unchanged.</p>}
  {(access.manager || access.departments.length > 0) && <section className="asset-inventory" id="requestable-inventory" aria-labelledby="inventory-heading">
   <div className="asset-inventory-heading"><div><h2 id="inventory-heading">{access.manager ? 'Stock by department' : 'Available for your department'}</h2><p className="muted">Available stock excludes reservations for approved requests.</p></div>{!items.error && <span className="muted">{items.count ?? 0} item types</span>}</div>
   <div className="asset-inventory-toolbar"><form method="get" className="asset-search">
    <label className="field asset-search-query">Department<select className="input" name="department" defaultValue={department}><option value="">{access.manager ? 'All departments' : 'My authorized departments'}</option>{departments.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <button className="button button-secondary">Filter inventory</button>{department && <Link className="button button-quiet" href="/app/inventory">Clear filter</Link>}
   </form></div>
   {items.error ? <p className="asset-inventory-feedback" role="alert">Inventory could not load. <Link href={href(page)}>Retry inventory</Link></p> : items.data?.length ? <InventoryTable items={items.data}/> : <p className="asset-inventory-feedback">No inventory found. {department ? 'Try another authorized department.' : 'An inventory manager can record received stock here.'}</p>}
   <div className="asset-inventory-footer"><span className="muted">Allocation, storage and assignment stay separate.</span><nav className="asset-pagination" aria-label="Inventory pages">{page > 1 && <Link className="button button-secondary" href={href(page - 1)}>Previous</Link>}<span>Page {page}</span>{page * 25 < (items.count ?? 0) && <Link className="button button-secondary" href={href(page + 1)}>Next</Link>}</nav></div>
  </section>}
  {access.manager && <section className="settings-card stack" id="receive-stock" aria-labelledby="receive-heading">
   <div className="inventory-section-heading"><div><h2 id="receive-heading">Receive stock</h2><p className="muted">Open an existing item above to record a delivery, or set up a new item type below.</p></div></div>
   <details><summary className="button button-secondary">Add a received item type</summary><ActionForm action={inventoryMutation} className="stack inventory-editor"><h3>Set up stock that has arrived</h3><CommandFields command="create" token={randomUUID()}/><label>Item name<input className="input" name="name" required minLength={2} maxLength={160}/></label><label>Tracking type<select className="input" name="kind"><option value="equipment">Equipment · individual assets</option><option value="consumable">Consumable · quantities</option></select></label><LookupSelect resource="departments" name="department" label="Department allocation" required/><LookupSelect resource="locations" name="location" label="Physical storage location" required/><p className="muted">Next, record the stock physically received. Department allocation is separate from storage and employee assignment.</p><SubmitButton className="button button-primary">Continue to receive stock</SubmitButton></ActionForm></details>
  </section>}
  <section className="settings-card stack" aria-labelledby="requests-heading">
   <div className="inventory-section-heading"><div><h2 id="requests-heading">{access.manager ? 'Inventory requests' : 'My request history'}</h2><p className="muted">Review progress and continue the conversation in Tickets.</p></div>{!requests.error && <span className="muted">{requests.count ?? 0} requests</span>}</div>
   {requests.error ? <p role="alert">Requests could not load. <Link href={href(page)}>Retry requests</Link></p> : requests.data?.length ? <ul className="asset-history-list inventory-request-list">{requests.data.map(r => <li key={r.id}>
    <div><Link href={`/app/tickets/${r.ticket_id}`}><strong>{contextLabel(r.context, 'item')}</strong></Link><p className="muted">{r.quantity} requested · {contextLabel(r.context, 'department')} · {r.destination}</p></div>
    <span className={`ticket-badge tone-${inventoryStates[r.state].tone}`}>{inventoryStates[r.state].label}</span>
   </li>)}</ul> : <p>No inventory requests found. Submitted requests will appear here and in Tickets.</p>}
   <nav className="asset-pagination" aria-label="Inventory request history pages">{history > 1 && <Link className="button button-secondary" href={href(page, history - 1)}>Previous requests</Link>}<span>Page {history}</span>{history * 25 < (requests.count ?? 0) && <Link className="button button-secondary" href={href(page, history + 1)}>More requests</Link>}</nav>
  </section>
 </div>;
}
