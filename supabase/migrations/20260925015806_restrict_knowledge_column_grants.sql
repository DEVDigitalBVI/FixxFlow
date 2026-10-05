begin;
-- Hosted default grants must be removed before granting selected write columns.
revoke all on public.knowledge_articles,public.knowledge_attachments,public.knowledge_article_views,public.knowledge_article_feedback from anon,authenticated;
grant select on public.knowledge_articles to authenticated;
grant insert(id,organization_id,category,title,summary,content,status,related_article_ids) on public.knowledge_articles to authenticated;
grant update(category,title,summary,content,status,related_article_ids) on public.knowledge_articles to authenticated;
grant select,delete on public.knowledge_attachments to authenticated;
grant insert(id,organization_id,article_id,storage_path,file_name,content_type,size_bytes) on public.knowledge_attachments to authenticated;
grant select on public.knowledge_article_views,public.knowledge_article_feedback to authenticated;
grant insert(organization_id,article_id) on public.knowledge_article_views to authenticated;
grant insert(organization_id,article_id,helpful) on public.knowledge_article_feedback to authenticated;
grant update(helpful) on public.knowledge_article_feedback to authenticated;
commit;
