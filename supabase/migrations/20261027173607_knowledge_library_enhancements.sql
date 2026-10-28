-- Organization preferences never alter or delete the shared source guide.
create table public.hidden_library_articles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  article_id uuid not null references public.library_articles(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(organization_id,article_id)
);
alter table public.hidden_library_articles enable row level security;
revoke all on public.hidden_library_articles from public,anon,authenticated;
grant select,delete on public.hidden_library_articles to authenticated;
grant insert(organization_id,article_id) on public.hidden_library_articles to authenticated;
grant all on public.hidden_library_articles to service_role;
create policy library_visibility_admin on public.hidden_library_articles for all to authenticated
 using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]))
 with check(private.has_organization_role(organization_id,array['administrator']::public.app_role[]) and created_by=auth.uid());
create policy library_visibility_assurance on public.hidden_library_articles as restrictive for all to authenticated
 using(private.has_required_assurance()) with check(private.has_required_assurance());

-- Definer lookup avoids recursing through article RLS and the administrator-only
-- preference table. Identity comes from auth.uid(), never a supplied member ID.
create function private.library_visible_in_workspace(article uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m where m.user_id=auth.uid()
   and m.status='active' and private.is_active_organization_member(m.organization_id)
   and not exists(select 1 from public.hidden_library_articles h
     where h.organization_id=m.organization_id and h.article_id=article));
$$;
revoke all on function private.library_visible_in_workspace(uuid) from public,anon;
grant execute on function private.library_visible_in_workspace(uuid) to authenticated;
drop policy library_read on public.library_articles;
create policy library_read on public.library_articles for select to authenticated using(
 private.platform_access()='ready' or
 (status='published' and private.library_visible_in_workspace(id) and exists(
   select 1 from public.organization_memberships m where m.user_id=auth.uid() and m.status='active'
   and private.is_active_organization_member(m.organization_id)
   and (audience='employees' or private.can_work_tickets(m.organization_id)))));

create function public.workspace_library_choices(org uuid, query text default '', page_number integer default 1)
returns table(id uuid,title text,summary text,category text,audience text,hidden boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_required_assurance() or not private.has_organization_role(org,array['administrator']::public.app_role[]) then
   raise exception 'Workspace administrator required' using errcode='42501'; end if;
 if page_number is null or page_number not between 1 and 10000 then raise exception 'Invalid page' using errcode='22023'; end if;
 return query select a.id,a.title,a.summary,a.category,a.audience,h.article_id is not null
 from public.library_articles a left join public.hidden_library_articles h on h.article_id=a.id and h.organization_id=org
 where a.status='published' and a.title ilike all(private.search_patterns(left(coalesce(query,''),200)))
 order by a.title,a.id limit 25 offset (page_number-1)*24;
end $$;
revoke all on function public.workspace_library_choices(uuid,text,integer) from public,anon;
grant execute on function public.workspace_library_choices(uuid,text,integer) to authenticated;

create function public.set_library_article_hidden(org uuid,article uuid,hide boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not private.has_required_assurance() or not private.has_organization_role(org,array['administrator']::public.app_role[]) then
   raise exception 'Workspace administrator required' using errcode='42501'; end if;
 if hide is null then raise exception 'Choose visibility' using errcode='22023'; end if;
 if hide then insert into public.hidden_library_articles(organization_id,article_id) values(org,article) on conflict do nothing;
 else delete from public.hidden_library_articles where organization_id=org and article_id=article; end if;
end $$;
revoke all on function public.set_library_article_hidden(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_library_article_hidden(uuid,uuid,boolean) to authenticated;
create function private.audit_library_visibility() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record; label text; actor_name text;
begin
 if tg_op='DELETE' then item:=old; else item:=new; end if;
 select a.title into label from public.library_articles a where a.id=item.article_id;
 select p.display_name into actor_name from public.profiles p where p.user_id=auth.uid() and p.organization_id=item.organization_id;
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(item.organization_id,auth.uid(),coalesce(actor_name,case when auth.uid() is null then 'System' else 'Member' end),'library_visibility',item.article_id,coalesce(label,'Library guide'),'updated',
 jsonb_build_array(jsonb_build_object('field','hidden','from',tg_op='DELETE','to',tg_op='INSERT')));
 return item;
end $$;
revoke all on function private.audit_library_visibility() from public,anon,authenticated;
create trigger library_visibility_audit after insert or delete on public.hidden_library_articles
 for each row execute function private.audit_library_visibility();

create table public.library_article_views (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 article_id uuid not null references public.library_articles(id) on delete cascade,
 user_id uuid not null default auth.uid(),
 viewed_on date not null default (now() at time zone 'UTC')::date,
 primary key(organization_id,article_id,user_id,viewed_on),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create table public.library_article_feedback (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 article_id uuid not null references public.library_articles(id) on delete cascade,
 user_id uuid not null default auth.uid(), helpful boolean not null,
 updated_at timestamptz not null default now(),
 primary key(organization_id,article_id,user_id),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create index library_views_member on public.library_article_views(organization_id,user_id);
create index library_feedback_member on public.library_article_feedback(organization_id,user_id);
create trigger library_feedback_updated before update on public.library_article_feedback for each row execute function private.set_updated_at();
alter table public.library_article_views enable row level security;
alter table public.library_article_feedback enable row level security;
revoke all on public.library_article_views,public.library_article_feedback from public,anon,authenticated;
grant select on public.library_article_views,public.library_article_feedback to authenticated;
grant insert(organization_id,article_id) on public.library_article_views to authenticated;
grant insert(organization_id,article_id,helpful),update(helpful) on public.library_article_feedback to authenticated;
grant all on public.library_article_views,public.library_article_feedback to service_role;
create policy library_views_read on public.library_article_views for select to authenticated using(private.can_work_tickets(organization_id));
create policy library_feedback_read on public.library_article_feedback for select to authenticated using(
 private.can_work_tickets(organization_id) or (user_id=auth.uid() and private.is_active_organization_member(organization_id)));
create policy library_views_insert on public.library_article_views for insert to authenticated with check(
 user_id=auth.uid() and private.is_active_organization_member(organization_id)
 and exists(select 1 from public.library_articles a where a.id=article_id and a.status='published'));
create policy library_feedback_insert on public.library_article_feedback for insert to authenticated with check(
 user_id=auth.uid() and private.is_active_organization_member(organization_id)
 and exists(select 1 from public.library_articles a where a.id=article_id and a.status='published'));
create policy library_feedback_update on public.library_article_feedback for update to authenticated
 using(user_id=auth.uid() and private.is_active_organization_member(organization_id)) with check(
 user_id=auth.uid() and private.is_active_organization_member(organization_id)
 and exists(select 1 from public.library_articles a where a.id=article_id and a.status='published'));
create policy library_views_assurance on public.library_article_views as restrictive for all to authenticated
 using(private.has_required_assurance()) with check(private.has_required_assurance());
create policy library_feedback_assurance on public.library_article_feedback as restrictive for all to authenticated
 using(private.has_required_assurance()) with check(private.has_required_assurance());
create function public.record_library_article_view(target_organization_id uuid,target_article_id uuid) returns void
language sql security invoker set search_path='' as $$
 insert into public.library_article_views(organization_id,article_id) values(target_organization_id,target_article_id) on conflict do nothing;
$$;
create function public.rate_library_article(target_organization_id uuid,target_article_id uuid,is_helpful boolean) returns void
language sql security invoker set search_path='' as $$
 insert into public.library_article_feedback(organization_id,article_id,helpful) values(target_organization_id,target_article_id,is_helpful)
 on conflict(organization_id,article_id,user_id) do update set helpful=excluded.helpful;
$$;
revoke all on function public.record_library_article_view(uuid,uuid),public.rate_library_article(uuid,uuid,boolean) from public,anon;
grant execute on function public.record_library_article_view(uuid,uuid),public.rate_library_article(uuid,uuid,boolean) to authenticated;

-- Match the expression index exactly when ranking request subjects.
create function private.article_suggestion_vector(heading text,description text) returns tsvector
language sql immutable parallel safe set search_path='' as $$
 select setweight(to_tsvector('english',regexp_replace(lower(heading),'wi[ -]?fi','wifi','g')),'A')
   ||setweight(to_tsvector('english',regexp_replace(lower(description),'wi[ -]?fi','wifi','g')),'B');
$$;
revoke all on function private.article_suggestion_vector(text,text) from public,anon;
grant execute on function private.article_suggestion_vector(text,text) to authenticated;
create index knowledge_suggestion_terms on public.knowledge_articles using gin(private.article_suggestion_vector(title,summary));
create index library_suggestion_terms on public.library_articles using gin(private.article_suggestion_vector(title,summary));
create index knowledge_related_title_search on public.knowledge_articles using gin(title extensions.gin_trgm_ops);
create index library_related_title_search on public.library_articles using gin(title extensions.gin_trgm_ops);
create index library_views_global_article on public.library_article_views(article_id);
create index library_feedback_global_article on public.library_article_feedback(article_id,helpful);
create index hidden_library_article_fk on public.hidden_library_articles(article_id);
create index hidden_library_creator_fk on public.hidden_library_articles(created_by);

-- OR-ranked lexemes match useful words in a natural-language request, instead of
-- requiring every word. The invoker view keeps draft/audience/hidden-guide RLS.
create function public.suggest_knowledge_articles(org uuid,query text,category_name text default '')
returns table(id uuid,organization_id uuid,title text,summary text,category text,audience text)
language sql stable security invoker set search_path='' as $$
 with input as (select replace(plainto_tsquery('english',regexp_replace(lower(left(coalesce(query,''),200)),'wi[ -]?fi','wifi','g'))::text,' & ',' | ')::tsquery terms),
 ranked as (
 select a.id,a.organization_id,a.title,a.summary,a.category,a.audience,
 ts_rank_cd(private.article_suggestion_vector(a.title,a.summary),i.terms)
 + case when a.category=category_name and category_name<>'' then 0.3 else 0 end score
 from public.readable_knowledge_articles a cross join input i
 where private.is_active_organization_member(org) and (a.organization_id=org or a.organization_id is null) and a.status='published'
 and (private.article_suggestion_vector(a.title,a.summary) @@ i.terms or (a.category=category_name and category_name<>''))
 ) select r.id,r.organization_id,r.title,r.summary,r.category,r.audience from ranked r where r.score>0 order by r.score desc,r.title,r.id limit 3;
$$;
revoke all on function public.suggest_knowledge_articles(uuid,text,text) from public,anon;
grant execute on function public.suggest_knowledge_articles(uuid,text,text) to authenticated;

-- Platform maintainers see aggregate guide performance, never individual readers.
create function public.library_article_usage(article uuid)
returns table(views bigint,helpful bigint,unhelpful bigint,workspaces bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if private.platform_access()<>'ready' or not private.has_required_assurance() then
  raise exception 'Verified platform owner required' using errcode='42501'; end if;
 return query select
  (select count(*) from public.library_article_views v where v.article_id=article),
  (select count(*) from public.library_article_feedback f where f.article_id=article and f.helpful),
  (select count(*) from public.library_article_feedback f where f.article_id=article and not f.helpful),
  (select count(distinct activity.organization_id) from (
    select v.organization_id from public.library_article_views v where v.article_id=article
    union select f.organization_id from public.library_article_feedback f where f.article_id=article
  ) activity);
end $$;
revoke all on function public.library_article_usage(uuid) from public,anon;
grant execute on function public.library_article_usage(uuid) to authenticated;
