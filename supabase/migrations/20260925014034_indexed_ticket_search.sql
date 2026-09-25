begin;
-- Expression indexes avoid copying private messages onto employee-readable tickets.
create index tickets_text_search_idx on public.tickets using gin (to_tsvector('simple',title || ' ' || description));
create index ticket_messages_text_search_idx on public.ticket_messages using gin (to_tsvector('simple',body));
create index profiles_text_search_idx on public.profiles using gin (to_tsvector('simple',display_name || ' ' || coalesce(email,'')));
create index ticket_categories_text_search_idx on public.ticket_categories using gin (to_tsvector('simple',name));
create index ticket_subcategories_text_search_idx on public.ticket_subcategories using gin (to_tsvector('simple',name));

-- Invoker rights preserve organization, message audience, and MFA policies at every source.
-- Return a relation so API filtering, sorting and pagination happen before the result limit.
create function public.search_tickets(target_organization_id uuid, search_text text)
returns setof public.tickets language sql stable security invoker set search_path = '' as $$
 with input as (
  select left(trim(search_text),200) as text,
   plainto_tsquery('simple',left(trim(search_text),200)) as query,
   case when trim(search_text) ~ '^#?[0-9]{1,15}$' then replace(trim(search_text),'#','')::bigint end as number
 ), matches as (
  select t.id from public.tickets t, input i
   where t.organization_id=target_organization_id and t.ticket_number=i.number
  union
  select t.id from public.tickets t, input i
   where t.organization_id=target_organization_id and i.text not like '#%'
    and to_tsvector('simple',t.title || ' ' || t.description) @@ i.query
  union
  select m.ticket_id from public.ticket_messages m, input i
   where m.organization_id=target_organization_id and i.text not like '#%'
    and to_tsvector('simple',m.body) @@ i.query
  union
  select t.id from public.profiles p join public.tickets t on t.organization_id=p.organization_id
   and (t.requester_id=p.user_id or t.assigned_technician_id=p.user_id), input i
   where p.organization_id=target_organization_id and i.text not like '#%'
    and to_tsvector('simple',p.display_name || ' ' || coalesce(p.email,'')) @@ i.query
  union
  select t.id from public.ticket_categories c join public.tickets t on t.organization_id=c.organization_id and t.category_id=c.id, input i
   where c.organization_id=target_organization_id and i.text not like '#%' and to_tsvector('simple',c.name) @@ i.query
  union
  select t.id from public.ticket_subcategories c join public.tickets t on t.organization_id=c.organization_id and t.subcategory_id=c.id, input i
   where c.organization_id=target_organization_id and i.text not like '#%' and to_tsvector('simple',c.name) @@ i.query
 ) select t.* from public.tickets t join matches m on m.id=t.id where t.organization_id=target_organization_id;
$$;
revoke all on function public.search_tickets(uuid,text) from public,anon;
grant execute on function public.search_tickets(uuid,text) to authenticated;
commit;
