import { UsageEvent } from "@/features/product-analytics/usage-event";
import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { knowledgeCategories } from "@/features/knowledge/content";

export default async function HelpPage({ searchParams }: { searchParams: Promise<{q?:string;category?:string;view?:string;page?:string}> }) {
  const viewer=await requireViewer(); const filters=await searchParams; const database=await createClient();
  const q=(filters.q??"").trim().slice(0,200); const staff=viewer.role!=="end_user";
  const page=Math.max(1,Math.min(10000,Number.parseInt(filters.page??"1",10)||1));
  const source=q ? database.rpc("search_knowledge_articles",{target_organization_id:viewer.organizationId,search_text:q}) : database.from("knowledge_articles");
  let query=source.select("id,title,summary,category,status,updated_at").eq("organization_id",viewer.organizationId);
  if (!staff || filters.view!=="all") query=query.eq("status","published");
  if(knowledgeCategories.some(c=>c===filters.category))query=query.eq("category",filters.category!);
  const {data,error}=await query.order("updated_at",{ascending:false}).order("id").range((page-1)*24,page*24);
  const pageHref=(next:number)=>`/app/help?${new URLSearchParams({q,category:filters.category??"",view:staff&&filters.view==="all"?"all":"published",page:String(next)})}`;
  return <div className="portal-page">{viewer.usageSharing && q && !error && page===1 && <UsageEvent key={q} event="search_performed" surface="knowledge"/>}<header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>Knowledge base</h1><p>Answers and guides from your IT team.</p></div>{staff&&<Link className="button button-primary" href="/app/help/new">New article</Link>}</header>
    <form className="queue-filters"><label>Search articles<input className="input" name="q" type="search" defaultValue={q} maxLength={200} placeholder="VPN error 809"/></label><label>Category<select className="input" name="category" defaultValue={filters.category??""}><option value="">All categories</option>{knowledgeCategories.map(c=><option key={c}>{c}</option>)}</select></label>{staff&&<label>Visibility<select className="input" name="view" defaultValue={filters.view??"published"}><option value="published">Published articles</option><option value="all">All, including drafts and archived</option></select></label>}<button className="button button-secondary">Search</button><Link href="/app/help">Clear filters</Link></form>
    {error?<div className="alert alert-error" role="alert">Articles could not be loaded. <Link href={pageHref(page)}>Try again</Link></div>:<>{data?.length?<div className="portal-articles">{data.slice(0,24).map(a=><article className="portal-detail-card" key={a.id}><p className="muted">{a.category}{a.status!=="published"?` · ${a.status}`:""}</p><h2><Link href={`/app/help/${a.id}`}>{a.title}</Link></h2><p>{a.summary||"Open this guide to read more."}</p></article>)}</div>:<div className="portal-empty"><h2>No articles found</h2><p>Try different words or another category.</p></div>}<nav className="notification-pagination" aria-label="Article pages">{page>1&&<Link className="button button-secondary" href={pageHref(page-1)}>Previous</Link>}<span>Page {page}</span>{(data?.length??0)>24&&<Link className="button button-secondary" href={pageHref(page+1)}>Next</Link>}</nav></>}
    <p className="portal-help-footer">Still need help? <Link href="/app/tickets/new">Submit a request</Link>.</p>
  </div>;
}
