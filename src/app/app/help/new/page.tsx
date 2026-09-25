import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { ArticleEditor } from "@/features/knowledge/article-editor";
export default async function NewArticlePage() {
 const viewer=await requireViewer();if(viewer.role==="end_user")notFound();const database=await createClient();
 const {data,error}=await database.from("knowledge_articles").select("id,title").eq("organization_id",viewer.organizationId).order("title").limit(200);
 if(error)return <div className="page"><h1>Editor unavailable</h1><p role="alert">Could not load article choices. Refresh to retry.</p></div>;
 return <div className="page"><Link href="/app/help">← Knowledge base</Link><h1>New article</h1><ArticleEditor isNew organizationId={viewer.organizationId} assets={[]} related={data??[]} article={{id:randomUUID(),organization_id:viewer.organizationId,title:"",summary:"",category:"Accounts",content:[{type:"paragraph",text:""}],status:"draft",related_article_ids:[],author_id:viewer.id,revision:1,search_body:"",created_at:"",updated_at:""}}/></div>;
}
