// Generates reviewable SQL only; it does not connect to or modify a database.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function articleId(organizationId, key) {
  const bytes = createHash('sha1').update(Buffer.from(organizationId.replaceAll('-', ''), 'hex')).update(`fixxflow-knowledge:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
export function buildImport(collection, organizationId, slug) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('An explicit organization UUID and slug are required.');
  const articles = collection.articles;
  const keys = new Set(articles.map(a => a.key));
  if (keys.size !== articles.length || articles.some(a => a.related.some(key => key === a.key || !keys.has(key)) || a.related.length > 8)) throw new Error('Invalid article keys or related guides.');
  const rows = articles.map(a => ({...a, id: articleId(organizationId, a.key)}));
  return `begin;
set local standard_conforming_strings = on;
do $$ begin
  if not exists (select 1 from public.organizations where id = ${literal(organizationId)}::uuid and slug = ${literal(slug)}) then
    raise exception 'Organization identity does not match; no guides were imported';
  end if;
end $$;
select pg_advisory_xact_lock(hashtextextended(${literal('knowledge-import:'+organizationId)}, 0));
create temporary table knowledge_import on commit drop as
select r.* from jsonb_to_recordset(${literal(JSON.stringify(rows))}::jsonb)
as r(id uuid, key text, category text, title text, summary text, content jsonb, related jsonb);
-- Reuse existing titles or stable IDs; never replace customer edits.
update knowledge_import i set id = coalesce(
  (select a.id from public.knowledge_articles a where a.organization_id = ${literal(organizationId)}::uuid
   and (a.id = i.id or lower(trim(a.title)) = lower(trim(i.title))) order by (a.id = i.id) desc, a.created_at, a.id limit 1), i.id);
create temporary table knowledge_import_created on commit drop as
with inserted as (
  insert into public.knowledge_articles(id,organization_id,category,title,summary,content,status,author_id)
  select i.id,${literal(organizationId)}::uuid,i.category,i.title,i.summary,i.content,'published',null from knowledge_import i
  where not exists (select 1 from public.knowledge_articles a where a.id = i.id)
  returning id
) select id from inserted;
-- Link only the articles created by this import; existing records stay untouched.
update public.knowledge_articles a set related_article_ids = array(
  select target.id from knowledge_import source
  cross join lateral jsonb_array_elements_text(source.related) with ordinality as relation(key,position)
  join knowledge_import target on target.key = relation.key
  where source.id = a.id order by relation.position
) where a.id in (select id from knowledge_import_created);
select (select count(*) from knowledge_import_created) as articles_created,
       (select count(*) from knowledge_import) as articles_in_collection;
commit;
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [organizationId, slug] = process.argv.slice(2);
  const collection = JSON.parse(fs.readFileSync(new URL('../content/knowledge/general-it.json', import.meta.url), 'utf8'));
  process.stdout.write(buildImport(collection, organizationId, slug));
}
