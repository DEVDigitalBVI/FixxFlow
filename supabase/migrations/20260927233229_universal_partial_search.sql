-- Substring search keeps identifiers intact and supports matches inside words.
create extension if not exists pg_trgm with schema extensions;

-- One search contract for every feature: bounded, case-insensitive literal
-- fragments, with every whitespace-separated term required in any order.
-- Escape LIKE metacharacters here rather than interpolating PostgREST syntax.
create function private.search_patterns(search_text text)
returns text[] language sql immutable parallel safe set search_path='' as $$
 select coalesce(array_agg(
  '%' || replace(replace(replace(term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
  order by length(term) desc, term
 ), array['%'])
 from (
  select distinct term
  from regexp_split_to_table(left(trim(regexp_replace(coalesce(search_text,''),'[[:space:]]+',' ','g')),200), ' ') as term
  where term <> ''
 ) terms;
$$;
revoke all on function private.search_patterns(text) from public,anon;
grant execute on function private.search_patterns(text) to authenticated;

create index assets_partial_search_idx on public.assets using gin (
 (name || ' ' || tag || ' ' || coalesce(serial_number,'') || ' ' || coalesce(model,'')) extensions.gin_trgm_ops
);

-- Invoker rights retain organization, assignment and MFA row-level policies.
-- Returning a relation lets the API apply lifecycle, counts and pagination in SQL.
create function public.search_assets(target_organization_id uuid, search_text text)
returns setof public.assets language sql stable security invoker set search_path = '' as $$
 with patterns as (select private.search_patterns(search_text) as terms)
 select a.* from public.assets a cross join patterns p
 where a.organization_id=target_organization_id
  -- The longest term is a separate predicate so the trigram index is usable.
  and (a.name || ' ' || a.tag || ' ' || coalesce(a.serial_number,'') || ' ' || coalesce(a.model,'')) ilike p.terms[1]
  and (a.name || ' ' || a.tag || ' ' || coalesce(a.serial_number,'') || ' ' || coalesce(a.model,'')) ilike all(p.terms);
$$;
revoke all on function public.search_assets(uuid,text) from public,anon;
grant execute on function public.search_assets(uuid,text) to authenticated;

create index knowledge_partial_search_idx on public.knowledge_articles using gin (
 (title || ' ' || summary || ' ' || search_body || ' ' || category) extensions.gin_trgm_ops
);
create or replace function public.search_knowledge_articles(target_organization_id uuid, search_text text)
returns setof public.knowledge_articles language sql stable security invoker set search_path='' as $$
 with patterns as (select private.search_patterns(search_text) as terms)
 select a.* from public.knowledge_articles a cross join patterns p
 where a.organization_id=target_organization_id
  and (a.title || ' ' || a.summary || ' ' || a.search_body || ' ' || a.category) ilike p.terms[1]
  and (a.title || ' ' || a.summary || ' ' || a.search_body || ' ' || a.category) ilike all(p.terms);
$$;

create index profiles_partial_search_idx on public.profiles using gin (
 (display_name || ' ' || coalesce(email,'') || ' ' || coalesce(job_title,'')) extensions.gin_trgm_ops
);
create function public.search_members(target_organization_id uuid, search_text text)
returns setof public.organization_memberships language sql stable security invoker set search_path='' as $$
 with patterns as (select private.search_patterns(search_text) as terms)
 select m.* from public.organization_memberships m
 join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.user_id
 cross join patterns s
 where m.organization_id=target_organization_id
  and (p.display_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,'')) ilike s.terms[1]
  and (p.display_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,'')) ilike all(s.terms);
$$;
revoke all on function public.search_members(uuid,text) from public,anon;
grant execute on function public.search_members(uuid,text) to authenticated;

create index audit_partial_search_idx on public.audit_events using gin (search_text extensions.gin_trgm_ops);
create function public.search_audit_events(target_organization_id uuid, search_text text)
returns setof public.audit_events language sql stable security invoker set search_path='' as $$
 with patterns as (select private.search_patterns(search_text) as terms)
 select a.* from public.audit_events a cross join patterns p
 where a.organization_id=target_organization_id
  and a.search_text ilike p.terms[1] and a.search_text ilike all(p.terms);
$$;
revoke all on function public.search_audit_events(uuid,text) from public,anon;
grant execute on function public.search_audit_events(uuid,text) to authenticated;

create index tickets_partial_search_idx on public.tickets using gin (
 (ticket_number::text || ' ' || title || ' ' || description) extensions.gin_trgm_ops
);
create index ticket_messages_partial_search_idx on public.ticket_messages using gin (body extensions.gin_trgm_ops);
create index ticket_categories_partial_search_idx on public.ticket_categories using gin (name extensions.gin_trgm_ops);
create index ticket_subcategories_partial_search_idx on public.ticket_subcategories using gin (name extensions.gin_trgm_ops);

-- Match every term against any visible ticket field or related record. Each
-- source still applies its own RLS, so hidden notes cannot influence a match.
create or replace function public.search_tickets(target_organization_id uuid, search_text text)
returns setof public.tickets language sql stable security invoker set search_path='' as $$
 with input as (
  select private.search_patterns(search_text) as patterns,
   case when trim(search_text) ~ '^#[0-9]{1,15}$' then substring(trim(search_text) from 2)::bigint end as exact_number
 ), terms as (
  select pattern from input i cross join lateral unnest(i.patterns) as pattern where i.exact_number is null
 ), matches as (
  select t.id, s.pattern from public.tickets t cross join terms s
   where t.organization_id=target_organization_id
    and (t.ticket_number::text || ' ' || t.title || ' ' || t.description) ilike s.pattern
  union
  select m.ticket_id, s.pattern from public.ticket_messages m cross join terms s
   where m.organization_id=target_organization_id and m.body ilike s.pattern
  union
  select t.id, s.pattern from public.profiles p
   join public.tickets t on t.organization_id=p.organization_id and (t.requester_id=p.user_id or t.assigned_technician_id=p.user_id)
   cross join terms s where p.organization_id=target_organization_id
    and (p.display_name || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.job_title,'')) ilike s.pattern
  union
  select t.id, s.pattern from public.ticket_categories c
   join public.tickets t on t.organization_id=c.organization_id and t.category_id=c.id
   cross join terms s where c.organization_id=target_organization_id and c.name ilike s.pattern
  union
  select t.id, s.pattern from public.ticket_subcategories c
   join public.tickets t on t.organization_id=c.organization_id and t.subcategory_id=c.id
   cross join terms s where c.organization_id=target_organization_id and c.name ilike s.pattern
 ), matched_ids as (
  select id from matches group by id having count(*)=(select cardinality(patterns) from input)
  union
  select t.id from public.tickets t cross join input i
   where t.organization_id=target_organization_id and t.ticket_number=i.exact_number
 )
 select t.* from public.tickets t join matched_ids m on m.id=t.id where t.organization_id=target_organization_id;
$$;

create index organizations_partial_search_idx on public.organizations using gin (
 (name || ' ' || slug) extensions.gin_trgm_ops
);
-- Preserve the platform-owner/session/MFA guard and the existing narrow payload.
create or replace function private.platform_overview(search_text text,page_number integer,days integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; patterns text[];
begin
 if private.platform_access()<>'ready' then raise exception 'Platform owner verification required' using errcode='42501'; end if;
 patterns:=private.search_patterns(search_text);
 select jsonb_build_object(
 'organizations',coalesce((select jsonb_agg(row) from (select o.id,o.name,o.slug,o.created_at,(select count(*) from public.organization_memberships m where m.organization_id=o.id and m.status='active') members from public.organizations o where (o.name||' '||o.slug) ilike patterns[1] and (o.name||' '||o.slug) ilike all(patterns) order by o.created_at desc,o.id limit 25 offset (greatest(1,least(coalesce(page_number,1),100000))-1)*25) row),'[]'::jsonb),
 'organizationCount',(select count(*) from public.organizations),
 'matchingCount',(select count(*) from public.organizations o where (o.name||' '||o.slug) ilike patterns[1] and (o.name||' '||o.slug) ilike all(patterns)),
 'usage',coalesce((select jsonb_agg(row) from (select event,role,surface,sum(count) count from private.product_usage_counts where day>=(now() at time zone 'UTC')::date-(greatest(1,least(coalesce(days,30),90))-1) group by event,role,surface order by event,role) row),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(row) from (select id,actor_id,organization_id,action,details,created_at from private.platform_audit order by id desc limit 50) row),'[]'::jsonb)
 ) into result;
 return result;
end $$;
