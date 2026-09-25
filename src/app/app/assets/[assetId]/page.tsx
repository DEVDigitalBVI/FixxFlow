import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {AssetForm} from '@/features/assets/asset-form';
import {assetOptions} from '@/features/assets/options';
import {assetKinds,assetStatuses} from '@/features/assets/model';
import {UsageEvent} from '@/features/product-analytics/usage-event';
export default async function AssetPage({params,searchParams}:{params:Promise<{assetId:string}>;searchParams:Promise<{saved?:string}>}) {
 const viewer=await requireViewer();const {assetId}=await params;const {saved}=await searchParams;const db=await createClient();const {data:asset,error}=await db.from('assets').select('*').eq('organization_id',viewer.organizationId).eq('id',assetId).maybeSingle();if(error)throw Error('Asset unavailable');if(!asset)notFound();
 const staff=viewer.role!=='end_user';const options=staff?await assetOptions(viewer.organizationId):null;
 const links=staff?await db.from('ticket_assets').select('ticket_id').eq('organization_id',viewer.organizationId).eq('asset_id',asset.id):null;
 const ids=links?.data?.map(l=>l.ticket_id)??[];const tickets=ids.length?await db.from('tickets').select('id,ticket_number,title,status').eq('organization_id',viewer.organizationId).in('id',ids).order('updated_at',{ascending:false}).limit(50):null;
 return <div className={staff?'page stack':'portal-page stack'}>{viewer.usageSharing&&<UsageEvent key={asset.id} event="asset_viewed" surface="assets" targetId={asset.id}/>}<header className="page-header"><div><Link href="/app/assets">← {staff?'Assets':'My equipment'}</Link><p className="page-eyebrow">{asset.tag}</p><h1>{asset.name}</h1><p>{assetKinds[asset.kind]} · {assetStatuses[asset.status]}</p></div></header>{saved&&<p className="alert alert-success" role="status">Asset saved.</p>}{staff&&options?<AssetForm key={`${asset.id}:${asset.revision}`} asset={asset} {...options}/>:<section className="portal-detail-card"><h2>Equipment details</h2><dl className="asset-facts"><dt>Model</dt><dd>{asset.model??'Not set'}</dd><dt>Serial number</dt><dd>{asset.serial_number??'Not set'}</dd><dt>Warranty ends</dt><dd>{asset.warranty_until??'Not set'}</dd></dl><Link className="button button-primary" href={`/app/tickets/new?asset=${asset.id}`}>Get help with this equipment</Link></section>}{staff&&<section className="settings-card"><h2>Ticket history</h2>{links?.error||tickets?.error?<p role="alert">History could not load. Refresh to try again.</p>:tickets?.data?.length?<ul>{tickets.data.map(t=><li key={t.id}><Link href={`/app/tickets/${t.id}`}>#{t.ticket_number} · {t.title}</Link></li>)}</ul>:<p className="muted">No tickets linked. Open a ticket and use its Linked assets section.</p>}</section>}</div>;
}
