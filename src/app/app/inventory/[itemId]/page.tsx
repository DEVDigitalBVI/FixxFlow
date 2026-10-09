import { InventoryStockSummary } from '@/features/inventory/inventory-table';
import { AssetStatusBadge } from '@/features/assets/asset-status-badge';
import { profileLabels } from '@/features/lookups/labels';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { pageNumber } from '@/lib/pagination';
import { inventoryAccess } from '@/features/inventory/access';
import { RequestForm, StockForm } from '@/features/inventory/forms';
import { contextLabel } from '@/features/inventory/model';
export default async function InventoryItemPage({params,searchParams}:{params:Promise<{itemId:string}>;searchParams:Promise<{page?:string;equipment?:string}>}) {
 const viewer=await requireViewer(), access=await inventoryAccess(viewer), db=await createClient(), {itemId}=await params, filters=await searchParams;
 const {data:item,error}=await db.from('inventory_items').select('*').eq('organization_id',viewer.organizationId).eq('id',itemId).maybeSingle();
 if(error)throw new Error('Inventory item could not load. Try again.'); if(!item)notFound();
 const page=pageNumber(filters.page), equipmentPage=pageNumber(filters.equipment);
 const [movements,units]=await Promise.all([
  access.manager ? db.from('inventory_movements').select('*',{count:'exact'}).eq('organization_id',viewer.organizationId).eq('item_id',item.id).order('created_at',{ascending:false}).order('id').range((page-1)*25,page*25-1) : {data:[],error:null,count:0},
  access.manager&&item.kind==='equipment' ? db.from('inventory_equipment').select('*',{count:'exact'}).eq('organization_id',viewer.organizationId).eq('item_id',item.id).order('asset_id').range((equipmentPage-1)*25,equipmentPage*25-1) : {data:[],error:null,count:0},
 ]);
 const assetIds=(units.data ?? []).map(u=>u.asset_id);
 const currentAssets=assetIds.length ? await db.from('assets').select('*').eq('organization_id',viewer.organizationId).in('id',assetIds) : {data:[],error:null};
 const currentOwners=await profileLabels(db,viewer.organizationId,(currentAssets.data ?? []).map(a=>a.assigned_user_id));
 const owners=new Map(currentOwners.map(p=>[p.user_id,p.display_name]));
 const assets=new Map((currentAssets.data ?? []).map(a=>[a.id,a]));
 const issuedIds=(units.data ?? []).flatMap(u=>u.request_id?[u.request_id]:[]);
 const issuedRequests=issuedIds.length ? await db.from('inventory_requests').select('id,destination,context').eq('organization_id',viewer.organizationId).in('id',issuedIds) : {data:[],error:null};
 const destinations=new Map((issuedRequests.data ?? []).map(r=>[r.id,r.destination]));
 const href=(n:number,e=equipmentPage)=>`/app/inventory/${item.id}?page=${n}&equipment=${e}`;
 return <div className={viewer.role==='end_user'&&!access.manager?'portal-page stack':'page stack'}><PageHeader title={item.name} back={{href:'/app/inventory',label:'Back to inventory'}} description={`${item.kind==='equipment'?'Equipment':'Consumable'} allocated to ${item.department_name}`} actions={access.manager ? <Link className="button button-primary" href="#receive-stock">Receive stock</Link> : access.departments.includes(item.department_id) ? <Link className="button button-primary" href="#request-item">Request an item</Link> : undefined}/>
  <InventoryStockSummary item={item}/>
  {access.departments.includes(item.department_id)&&<section className="settings-card stack" id="request-item"><h2>Request an item</h2><RequestForm item={item} token={randomUUID()}/></section>}
  {access.manager&&<>
   <details className="settings-card" id="receive-stock"><summary className="button button-secondary">Receive stock</summary><StockForm item={item} command="receive" token={randomUUID()}/></details>
   <details className="settings-card"><summary className="button button-secondary">Correct stock</summary><p className="muted">Corrections need a reason. Stock cannot fall below active reservations.</p><StockForm item={item} command="correct" token={randomUUID()}/></details>
   {item.kind==='equipment'&&<section className="settings-card stack"><h2>Stored and issued equipment</h2>{(units.error||currentAssets.error||issuedRequests.error)?<p role="alert">Equipment could not load. Reload to retry.</p>:units.data?.length?<ul className="stack">{units.data.map(u=><li key={u.asset_id}><Link href={`/app/assets/${u.asset_id}`}>{contextLabel(u.asset_context,'tag')} · {contextLabel(u.asset_context,'name')}</Link><p>{u.state==='issued'?'Issued to department':u.state==='reserved'?'Reserved for approved request':u.state==='removed'?'Removed by stock correction':'Physically in storage'} · Serial: {contextLabel(u.asset_context,'serial')||'Not recorded'}</p>{assets.get(u.asset_id)&&<p><AssetStatusBadge status={assets.get(u.asset_id)!.status}/> · Assigned employee: {owners.get(assets.get(u.asset_id)!.assigned_user_id ?? '')||'Unassigned'}{u.request_id&&` · Issued destination: ${destinations.get(u.request_id)||'See request'}`}</p>}</li>)}</ul>:<p>No equipment received yet.</p>}<nav className="asset-pagination" aria-label="Equipment pages">{equipmentPage>1&&<Link className="button button-secondary" href={href(page,equipmentPage-1)}>Previous equipment</Link>}<span>Page {equipmentPage}</span>{equipmentPage*25<(units.count??0)&&<Link className="button button-secondary" href={href(page,equipmentPage+1)}>More equipment</Link>}</nav></section>}
   <section className="settings-card stack"><h2>Receipt, reservation and department usage history</h2><p className="muted">Issued consumables remain in this ledger after use. Equipment remains tracked in Assets.</p>{movements.error?<p role="alert">History could not load. Reload to retry.</p>:movements.data?.length?<ol className="stack">{movements.data.map(m=><li key={m.id}><strong>{m.kind.replace(/^./,c=>c.toUpperCase())} · {m.quantity}</strong><p>{new Date(m.created_at).toLocaleString('en-US')} · {m.actor_name}</p><p>{contextLabel(m.context,'department')} · {contextLabel(m.context,'storage')}{contextLabel(m.context,'destination')&&` · To ${contextLabel(m.context,'recipient')} ${contextLabel(m.context,'destination')}`}</p>{m.note&&<p>{m.note}</p>}</li>)}</ol>:<p>No stock movements yet. Record received stock to make this item requestable.</p>}<nav className="asset-pagination" aria-label="Stock history pages">{page>1&&<Link className="button button-secondary" href={href(page-1)}>Previous history</Link>}<span>Page {page}</span>{page*25<(movements.count??0)&&<Link className="button button-secondary" href={href(page+1)}>More history</Link>}</nav></section>
  </>}
 </div>;
}
