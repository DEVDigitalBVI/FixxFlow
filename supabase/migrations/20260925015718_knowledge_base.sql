begin;
create table public.knowledge_articles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 category text not null check(category in ('Accounts','Email','Network','Hardware','Software','Security')),
 title text not null check(char_length(trim(title)) between 3 and 180),
 summary text not null default '' check(char_length(summary)<=500),
 content jsonb not null default '[]' check(jsonb_typeof(content)='array' and jsonb_array_length(content)<=100 and octet_length(content::text)<=100000),
 search_body text not null default '',
 status text not null default 'draft' check(status in ('draft','published','archived')),
 related_article_ids uuid[] not null default '{}' check(cardinality(related_article_ids)<=8),
 author_id uuid default auth.uid(),
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,id),
 foreign key(organization_id,author_id) references public.organization_memberships(organization_id,user_id)
);
create index knowledge_articles_category_idx on public.knowledge_articles(organization_id,status,category,updated_at desc,id);
create index knowledge_articles_author_idx on public.knowledge_articles(organization_id,author_id);
create index knowledge_articles_search_idx on public.knowledge_articles using gin(to_tsvector('simple',title||' '||summary||' '||search_body));
create function private.prepare_knowledge_article() returns trigger language plpgsql set search_path='' as $$
declare block jsonb;
begin
 new.search_body := '';
 for block in select value from jsonb_array_elements(new.content) loop
  if jsonb_typeof(block)<>'object' or not (block ? 'type') or coalesce(block->>'type','') not in ('paragraph','heading','list','quote','code','link','image')
   or not(block ? 'text') or jsonb_typeof(block->'text')<>'string' then raise exception 'Invalid article block'; end if;
  if block->>'type'='link' and (coalesce(block->>'url','') !~ '^https?://[^[:space:]]+$') then raise exception 'Use an HTTP or HTTPS link'; end if;
  if block->>'type'='image' and (coalesce(block->>'assetId','') !~ '^[0-9a-fA-F-]{36}$' or length(trim(block->>'text'))=0) then raise exception 'Choose an image and add alt text'; end if;
  new.search_body := new.search_body||' '||(block->>'text');
 end loop;
 if new.status='published' and length(trim(new.search_body))=0 then raise exception 'Published articles require content'; end if;
 if new.id=any(new.related_article_ids) or exists(select 1 from unnest(new.related_article_ids) related_id
   where not exists(select 1 from public.knowledge_articles a where a.id=related_id and a.organization_id=new.organization_id)) then raise exception 'Related articles must belong to this organization'; end if;
 if tg_op='UPDATE' then new.revision:=old.revision+1; new.updated_at:=now(); end if;
 return new;
end $$;
revoke all on function private.prepare_knowledge_article() from public,anon,authenticated;
create trigger knowledge_article_prepare before insert or update on public.knowledge_articles for each row execute function private.prepare_knowledge_article();
alter table public.knowledge_articles enable row level security;
create policy knowledge_article_read on public.knowledge_articles for select to authenticated using(
 (select private.is_active_organization_member(organization_id)) and (status='published' or (select private.can_work_tickets(organization_id))));
create policy knowledge_article_insert on public.knowledge_articles for insert to authenticated with check((select private.can_work_tickets(organization_id)) and author_id=(select auth.uid()));
create policy knowledge_article_update on public.knowledge_articles for update to authenticated using((select private.can_work_tickets(organization_id))) with check((select private.can_work_tickets(organization_id)));
grant select on public.knowledge_articles to authenticated;
grant insert(id,organization_id,category,title,summary,content,status,related_article_ids) on public.knowledge_articles to authenticated;
grant update(category,title,summary,content,status,related_article_ids) on public.knowledge_articles to authenticated;

create table public.knowledge_attachments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, article_id uuid not null,
 storage_path text not null unique, file_name text not null check(char_length(file_name) between 1 and 255),
 content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=6291456),
 created_at timestamptz not null default now(),
 foreign key(organization_id,article_id) references public.knowledge_articles(organization_id,id) on delete cascade,
 check(split_part(storage_path,'/',1)=organization_id::text and split_part(storage_path,'/',2)=article_id::text)
);
create index knowledge_attachments_article_idx on public.knowledge_attachments(organization_id,article_id);
alter table public.knowledge_attachments enable row level security;
create policy knowledge_asset_read on public.knowledge_attachments for select to authenticated using(exists(select 1 from public.knowledge_articles a where a.id=article_id and a.organization_id=knowledge_attachments.organization_id));
create policy knowledge_asset_insert on public.knowledge_attachments for insert to authenticated with check((select private.can_work_tickets(organization_id)) and exists(select 1 from public.knowledge_articles a where a.id=article_id and a.organization_id=knowledge_attachments.organization_id));
create policy knowledge_asset_delete on public.knowledge_attachments for delete to authenticated using((select private.can_work_tickets(organization_id)));
grant select,delete on public.knowledge_attachments to authenticated;
grant insert(id,organization_id,article_id,storage_path,file_name,content_type,size_bytes) on public.knowledge_attachments to authenticated;

create table public.knowledge_article_views (
 organization_id uuid not null, article_id uuid not null, user_id uuid not null default auth.uid(),
 viewed_on date not null default (now() at time zone 'UTC')::date,
 primary key(article_id,user_id,viewed_on),
 foreign key(organization_id,article_id) references public.knowledge_articles(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create table public.knowledge_article_feedback (
 organization_id uuid not null, article_id uuid not null, user_id uuid not null default auth.uid(),
 helpful boolean not null, updated_at timestamptz not null default now(),
 primary key(article_id,user_id),
 foreign key(organization_id,article_id) references public.knowledge_articles(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create trigger knowledge_feedback_updated before update on public.knowledge_article_feedback for each row execute function private.set_updated_at();
create index knowledge_views_article_idx on public.knowledge_article_views(organization_id,article_id);
create index knowledge_views_member_idx on public.knowledge_article_views(organization_id,user_id);
create index knowledge_feedback_article_idx on public.knowledge_article_feedback(organization_id,article_id);
create index knowledge_feedback_member_idx on public.knowledge_article_feedback(organization_id,user_id);
alter table public.knowledge_article_views enable row level security;
alter table public.knowledge_article_feedback enable row level security;
create policy knowledge_views_read on public.knowledge_article_views for select to authenticated using((select private.can_work_tickets(organization_id)));
create policy knowledge_feedback_read on public.knowledge_article_feedback for select to authenticated using((select private.can_work_tickets(organization_id)) or (user_id=(select auth.uid()) and (select private.is_active_organization_member(organization_id))));
create policy knowledge_views_insert on public.knowledge_article_views for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.knowledge_articles a where a.id=article_id and a.organization_id=knowledge_article_views.organization_id and a.status='published'));
create policy knowledge_feedback_insert on public.knowledge_article_feedback for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.knowledge_articles a where a.id=article_id and a.organization_id=knowledge_article_feedback.organization_id and a.status='published'));
create policy knowledge_feedback_update on public.knowledge_article_feedback for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.knowledge_articles a where a.id=article_id and a.organization_id=knowledge_article_feedback.organization_id and a.status='published'));
grant select on public.knowledge_article_views,public.knowledge_article_feedback to authenticated;
grant insert(organization_id,article_id) on public.knowledge_article_views to authenticated;
grant insert(organization_id,article_id,helpful) on public.knowledge_article_feedback to authenticated;
grant update(helpful) on public.knowledge_article_feedback to authenticated;

-- Invoker RPCs derive identity and time in the database and never accept a reader ID.
create function public.record_article_view(target_organization_id uuid,target_article_id uuid) returns void language sql security invoker set search_path='' as $$
 insert into public.knowledge_article_views(organization_id,article_id) values(target_organization_id,target_article_id) on conflict do nothing;
$$;
create function public.rate_article(target_organization_id uuid,target_article_id uuid,is_helpful boolean) returns void language sql security invoker set search_path='' as $$
 insert into public.knowledge_article_feedback(organization_id,article_id,helpful) values(target_organization_id,target_article_id,is_helpful)
 on conflict(article_id,user_id) do update set helpful=excluded.helpful;
$$;
create function public.search_knowledge_articles(target_organization_id uuid,search_text text) returns setof public.knowledge_articles language sql stable security invoker set search_path='' as $$
 select * from public.knowledge_articles where organization_id=target_organization_id
 and to_tsvector('simple',title||' '||summary||' '||search_body) @@ plainto_tsquery('simple',left(trim(search_text),200));
$$;
revoke all on function public.record_article_view(uuid,uuid),public.rate_article(uuid,uuid,boolean),public.search_knowledge_articles(uuid,text) from public,anon;
grant execute on function public.record_article_view(uuid,uuid),public.rate_article(uuid,uuid,boolean),public.search_knowledge_articles(uuid,text) to authenticated;

do $$ declare t text; begin
 foreach t in array array['knowledge_articles','knowledge_attachments','knowledge_article_views','knowledge_article_feedback'] loop
  execute format('create policy require_enrolled_mfa on public.%I as restrictive for all to authenticated using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()))',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('knowledge-assets','knowledge-assets',false,6291456,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy knowledge_storage_read on storage.objects for select to authenticated using(bucket_id='knowledge-assets' and exists(select 1 from public.knowledge_articles a where a.organization_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2]));
create policy knowledge_storage_insert on storage.objects for insert to authenticated with check(bucket_id='knowledge-assets' and exists(select 1 from public.knowledge_articles a where a.organization_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and (select private.can_work_tickets(a.organization_id))));
create policy knowledge_storage_delete on storage.objects for delete to authenticated using(bucket_id='knowledge-assets' and exists(select 1 from public.knowledge_articles a where a.organization_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and (select private.can_work_tickets(a.organization_id))));

create function private.seed_knowledge_articles(org uuid) returns void language sql security definer set search_path='' as $$
 insert into public.knowledge_articles(organization_id,category,title,content,status,author_id)
 select org,v.category,v.title,jsonb_build_array(jsonb_build_object('type','paragraph','text',v.body)),'published',null
 from (values ('Accounts','Reset your password','Use the Forgot password link on the sign-in page. Open the email we send you and choose a new password. If you cannot access your email, contact IT.'),('Network','Connect to Wi-Fi','Choose your organization’s Wi-Fi network, enter your work credentials, and reconnect. If the network is missing or your credentials are rejected, send IT a request with your location and device type.'),('Security','Set up multi-factor authentication','Open Account security, choose Set up authenticator, and scan the code with your authenticator app. Keep your recovery method in a safe place.'),('Security','Report a lost device','Contact IT as soon as possible. Tell us what device is missing, when you last had it, and how we can reach you. If your account may be exposed, reset your password.')) v(category,title,body);
$$;
revoke all on function private.seed_knowledge_articles(uuid) from public,anon,authenticated;
select private.seed_knowledge_articles(id) from public.organizations;
create function private.seed_organization_knowledge() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.seed_knowledge_articles(new.id); return new; end $$;
revoke all on function private.seed_organization_knowledge() from public,anon,authenticated;
create trigger organization_knowledge_seed after insert on public.organizations for each row execute function private.seed_organization_knowledge();

commit;
