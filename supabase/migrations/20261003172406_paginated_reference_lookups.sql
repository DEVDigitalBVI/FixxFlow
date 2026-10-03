-- Small, searchable pages; invoker rights preserve tenant and MFA RLS.
create function public.lookup_choices(
 org uuid, resource text, query text default '', after_label text default null,
 after_id uuid default null, selected uuid default null, parent uuid default null,
 active_only boolean default true
) returns table(id uuid, label text, active boolean, parent_id uuid)
language sql stable security invoker set search_path='' as $$
 with choices as (
  select p.user_id id, p.display_name || case when p.email is null then '' else ' · ' || p.email end label,
   m.status='active' active, null::uuid parent_id
  from public.profiles p join public.organization_memberships m using (organization_id,user_id)
  where p.organization_id=org and resource in ('people','technicians')
   and (resource='people' or m.role in ('administrator','technician'))
   and private.has_organization_role(org,array['administrator','technician']::public.app_role[])
  union all select t.id,t.name,t.is_active,null::uuid from public.teams t
   where t.organization_id=org and resource='teams'
   and private.has_organization_role(org,array['administrator','technician']::public.app_role[])
  union all select d.id,d.name,d.is_active,null::uuid from public.departments d where d.organization_id=org and resource='departments'
  union all select l.id,l.name,l.is_active,null::uuid from public.locations l where l.organization_id=org and resource='locations'
  union all select c.id,c.name,c.is_active,null::uuid from public.ticket_categories c where c.organization_id=org and resource='categories'
  union all select s.id,s.name,s.is_active,s.category_id from public.ticket_subcategories s where s.organization_id=org and resource='subcategories' and s.category_id=parent
 )
 select c.id,c.label,c.active,c.parent_id from choices c
 where private.is_active_organization_member(org)
 and case when selected is not null then c.id=selected else
  (not active_only or c.active) and c.label ilike all(private.search_patterns(query))
  and (after_id is null or (c.label,c.id)>(after_label,after_id)) end
 order by c.label,c.id limit 51;
$$;
revoke all on function public.lookup_choices(uuid,text,text,text,uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.lookup_choices(uuid,text,text,text,uuid,uuid,uuid,boolean) to authenticated;
