import { LiveSearchForm } from '@/components/ui/live-search-form';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import Link from 'next/link';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {assetKinds,assetStatuses} from '@/features/assets/model';
import {PageHeader} from '@/components/ui/page-header';
import {AssetStatusBadge} from '@/features/assets/asset-status-badge';
import {AssetLinkForm} from '@/features/assets/ticket-link-form';
export default async function AssetsPage({searchParams}:{searchParams:Promise<{q?:string;status?:string;page?:string;ticket?:string}>}) {
 const viewer=await requireViewer();const staff=viewer.role!=='end_user';const params=await searchParams;const q=normalizeSearch(params.q);const page=pageNumber(params.page);const status=typeof params.status==='string'&&Object.hasOwn(assetStatuses,params.status)?params.status as keyof typeof assetStatuses:'';const db=await createClient();
 const source=q?db.rpc('search_assets',{target_organization_id:viewer.organizationId,search_text:q},{count:'exact'}):db.from('assets');
 let query=source.select('*',{count:'exact'}).eq('organization_id',viewer.organizationId);
 if(!staff)query=query.eq('assigned_user_id',viewer.id);
 if(status)query=query.eq('status',status);
 const ticket=staff&&/^[0-9a-f-]{36}$/i.test(params.ticket??'')?params.ticket:null;
 const [{data,error,count},ticketR]=await Promise.all([
  query.order('updated_at',{ascending:false}).order('id').range((page-1)*25,page*25-1),
  ticket?db.from('tickets').select('id,ticket_number').eq('organization_id',viewer.organizationId).eq('id',ticket).maybeSingle():null,
 ]);
 const href=(n:number)=>`/app/assets?${new URLSearchParams({q,status,page:String(n),...(ticket?{ticket}:{})})}`;
 const clearHref=ticket?`/app/assets?${new URLSearchParams({ticket})}`:'/app/assets';
 const filtered=Boolean(q||status);
 return <div className={`${staff?'page':'portal-page'} assets-page`}>
  <PageHeader title={staff?'Assets':'My equipment'} eyebrow={viewer.organizationName} description={staff?'Equipment, ownership and service history in one place.':'Equipment assigned to you by your IT team.'} actions={staff?<><Link className="button button-secondary" href="/app/assets/import">Import spreadsheet</Link><Link className="button button-primary" href="/app/assets/new">Add asset</Link></>:undefined}/>
  {ticketR?.data&&<div className="alert asset-ticket-context"><div><strong>Link equipment to Ticket #{ticketR.data.ticket_number}</strong><p>Find the asset below, then choose Link to ticket.</p></div><Link className="button button-secondary" href={`/app/tickets/${ticket}`}>Back to ticket</Link></div>}
  <section className="asset-inventory" aria-labelledby="inventory-heading">
   <header className="asset-inventory-heading"><div><h2 id="inventory-heading">{filtered?'Filtered inventory':staff?'Your inventory':'Your equipment'}</h2><p>{error?'Inventory unavailable':`${count??0} ${filtered?'matching ':''}${count===1?'asset':'assets'}`}</p></div><span className="muted">Most recently updated first</span></header>
   <div className="asset-inventory-toolbar"><LiveSearchForm action="/app/assets" className="asset-search" label="Search assets" resultSummary={error?'Assets could not load. Use Search to try again.':`${count??0} matching assets. Page ${page}.`}>
    <label className="field asset-search-query">Search name, tag, serial number or model<input className="input" name="q" type="search" defaultValue={q} maxLength={SEARCH_LIMIT} aria-describedby="asset-search-hint" placeholder="Find equipment in your workspace…"/></label>
    <label className="field asset-search-lifecycle">Lifecycle<select className="input" name="status" defaultValue={status}><option value="">All states</option>{Object.entries(assetStatuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {ticket&&<input type="hidden" name="ticket" value={ticket}/>}
    <button className="button button-secondary" type="submit">Search assets</button>{filtered&&<Link className="button button-quiet" href={clearHref}>Clear filters</Link>}
   </LiveSearchForm><span className="sr-only" id="asset-search-hint">{SEARCH_HINT}</span></div>
   {error?<div className="asset-inventory-feedback"><div className="alert alert-error" role="alert">Assets could not load. <Link className="button button-secondary" href={href(page)}>Try again</Link></div></div>:data?.length?<div className="table-region" role="region" aria-label="Asset inventory" tabIndex={0}><table className="table responsive-table table-nowrap asset-inventory-table"><thead><tr><th scope="col">Asset</th><th scope="col">Serial number</th><th scope="col">Type</th><th scope="col">Lifecycle</th><th scope="col">Model</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.map(a=><tr key={a.id}>
    <td data-label="Asset"><Link className="asset-name" href={`/app/assets/${a.id}`}>{a.name}</Link><div className="asset-tag">{a.tag}</div></td>
    <td data-label="Serial number">{a.serial_number??'Not set'}</td><td data-label="Type">{assetKinds[a.kind]}</td><td data-label="Lifecycle"><AssetStatusBadge status={a.status}/></td><td data-label="Model">{a.model??'Not set'}</td>
    <td data-label="Actions"><div className="asset-row-actions"><Link className="button button-secondary" href={`/app/assets/${a.id}`}>Open<span className="sr-only"> {a.name}</span></Link>{ticketR?.data&&<AssetLinkForm ticketId={ticketR.data.id} asset={a} link/>}</div></td>
   </tr>)}</tbody></table></div>:<div className="empty-state asset-empty"><h3>{filtered?'No matching assets':page>1?'No assets on this page':staff?'Keep your equipment in view':'No equipment assigned'}</h3><p>{filtered?'Try a shorter name or serial-number fragment, or clear the filters.':page>1?'Return to the first page to see your inventory.':staff?'Add your first asset to track its details, ownership and support history.':'Your IT team will add equipment here when it is assigned to you.'}</p>{filtered?<Link className="button button-secondary" href={clearHref}>Clear filters</Link>:page>1?<Link className="button button-secondary" href={href(1)}>Back to inventory</Link>:staff?<Link className="button button-primary" href="/app/assets/new">Add your first asset</Link>:null}</div>}
   {!error&&<footer className="asset-inventory-footer"><span className="muted">{data?.length?`${(page-1)*25+1}–${Math.min(page*25,count??0)} of ${count??0}`:'No results'}</span><nav className="asset-pagination" aria-label="Asset pages">{page>1&&<Link className="button button-secondary" href={href(page-1)}>Previous</Link>}<span>Page {page}</span>{page*25<(count??0)&&<Link className="button button-secondary" href={href(page+1)}>Next</Link>}</nav></footer>}
  </section>
 </div>;
}
