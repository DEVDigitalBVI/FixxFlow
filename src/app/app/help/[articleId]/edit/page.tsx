import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { ArticleEditor } from "@/features/knowledge/article-editor";
import { validId } from "@/features/knowledge/content";
export default async function EditArticlePage({params}:{params:Promise<{articleId:string}>}) {
  const viewer=await requireViewer(); if(viewer.role==="end_user")notFound();
  const {articleId}=await params;if(!validId(articleId))notFound(); const database=await createClient();
  const [article,assets,related]=await Promise.all([
    database.from("knowledge_articles").select("*").eq("organization_id",viewer.organizationId).eq("id",articleId).maybeSingle(),
    database.from("knowledge_attachments").select("*").eq("organization_id",viewer.organizationId).eq("article_id",articleId),
    database.from("knowledge_articles").select("id,title").eq("organization_id",viewer.organizationId).neq("id",articleId).order("title").limit(200),
  ]);
  if(article.error||assets.error||related.error)return <div className="page"><h1>Editor unavailable</h1><p role="alert">Could not load the editor. Refresh to retry.</p></div>;
  if(!article.data)notFound();
  // Keep older related selections available even if they fall beyond the first 200 choices.
  const missing=article.data.related_article_ids.filter(id=>!related.data?.some(a=>a.id===id));
  const extra=missing.length?await database.from("knowledge_articles").select("id,title").eq("organization_id",viewer.organizationId).in("id",missing):{data:[],error:null};
  if(extra.error)return <div className="page"><p role="alert">Could not load related articles. Refresh to retry.</p></div>;
  return <div className="page"><Link href={`/app/help/${articleId}`}>← Article</Link><h1>Edit article</h1><ArticleEditor article={article.data} organizationId={viewer.organizationId} assets={assets.data??[]} related={[...related.data??[],...extra.data??[]]}/></div>;
}
