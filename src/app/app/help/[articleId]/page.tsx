import { UsageEvent } from "@/features/product-analytics/usage-event";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { validId } from "@/features/knowledge/content";
import { ArticleContent } from "@/features/knowledge/article-content";
import { ArticleFeedback } from "@/features/knowledge/article-feedback";
export default async function ArticlePage({params}:{params:Promise<{articleId:string}>}) {
  const viewer=await requireViewer(); const {articleId}=await params; if(!validId(articleId))notFound();
  const database=await createClient(); const staff=viewer.role!=="end_user";
  const {data:article,error}=await database.from("knowledge_articles").select("*").eq("organization_id",viewer.organizationId).eq("id",articleId).maybeSingle();
  if(error)return <div className="page"><h1>Article unavailable</h1><p role="alert">The article could not be loaded. Please refresh to retry.</p></div>;
  if(!article)notFound();
  const [assetResult,relatedResult,feedback,views,helpful,unhelpful]=await Promise.all([
    database.from("knowledge_attachments").select("*").eq("organization_id",viewer.organizationId).eq("article_id",articleId).order("created_at"),
    article.related_article_ids.length?database.from("knowledge_articles").select("id,title").eq("organization_id",viewer.organizationId).in("id",article.related_article_ids):Promise.resolve({data:[],error:null}),
    database.from("knowledge_article_feedback").select("helpful").eq("article_id",articleId).eq("user_id",viewer.id).maybeSingle(),
    staff?database.from("knowledge_article_views").select("article_id",{head:true,count:"exact"}).eq("organization_id",viewer.organizationId).eq("article_id",articleId):Promise.resolve({count:null,error:null}),
    staff?database.from("knowledge_article_feedback").select("article_id",{head:true,count:"exact"}).eq("organization_id",viewer.organizationId).eq("article_id",articleId).eq("helpful",true):Promise.resolve({count:null,error:null}),
    staff?database.from("knowledge_article_feedback").select("article_id",{head:true,count:"exact"}).eq("organization_id",viewer.organizationId).eq("article_id",articleId).eq("helpful",false):Promise.resolve({count:null,error:null}),
  ]);
  const images=Object.fromEntries((assetResult.data??[]).filter(a=>a.content_type.startsWith("image/")).map(a=>[a.id,`/app/help/assets/${a.id}`]));
  return <div className="portal-page knowledge-detail">{viewer.usageSharing && <UsageEvent key={articleId} event="knowledge_article_viewed" surface="knowledge" targetId={articleId}/>}<header className="portal-page-heading"><div><Link href="/app/help">← Knowledge base</Link><p className="muted">{article.category} · {article.status}</p><h1>{article.title}</h1><p>{article.summary}</p></div>{staff&&<Link className="button button-secondary" href={`/app/help/${article.id}/edit`}>Edit article</Link>}</header>
    {article.status!=="published"&&<p className="alert alert-error">This {article.status} article is visible to IT staff only.</p>}
    <article className="portal-detail-card"><ArticleContent content={article.content} images={images} showContents/></article>
    <section className="settings-card"><h2>Attachments</h2>{assetResult.error?<p role="alert">Attachments could not be loaded. Refresh to retry.</p>:assetResult.data?.length?<ul>{assetResult.data.map(a=><li key={a.id}><a href={`/app/help/assets/${a.id}?download=1`}>{a.file_name}</a> <span className="muted">({Math.ceil(a.size_bytes/1024)} KB)</span></li>)}</ul>:<p className="muted">No attachments.</p>}</section>
    {(relatedResult.error||!!relatedResult.data?.length)&&<section className="settings-card"><h2>Related articles</h2>{relatedResult.error?<p role="alert">Related articles could not be loaded.</p>:<ul>{relatedResult.data?.map(a=><li key={a.id}><Link href={`/app/help/${a.id}`}>{a.title}</Link></li>)}</ul>}</section>}
    <section className="settings-card"><h2>Still need help?</h2><p>Tell IT what happened and which steps you tried. Include this article’s title in your request.</p><Link className="button button-primary" href="/app/tickets/new">Submit a request</Link></section>
    {article.status==="published"&&<ArticleFeedback articleId={article.id} initial={feedback.data?.helpful??null}/>}
    {staff&&<section className="settings-card"><h2>Article insights</h2>{views.error||helpful.error||unhelpful.error?<p role="alert">Insights could not be loaded.</p>:<><dl className="knowledge-metrics"><div><dt>Views</dt><dd>{views.count??0}</dd></div><div><dt>Helpful</dt><dd>{helpful.count??0}</dd></div><div><dt>Not helpful</dt><dd>{unhelpful.count??0}</dd></div></dl><p className="muted">Views count each signed-in reader once per UTC day. Votes reflect each reader’s latest choice. Refresh to see new activity.</p></>}</section>}
  </div>;
}
