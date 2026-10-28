-- Platform-owner organization summary export. Returns account metadata and
-- aggregate counts only: no names of people, ticket text, messages, articles or
-- asset details. Every export is recorded in the platform audit log.
create function private.platform_organization_export(search_text text, export_format text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  term text := left(btrim(coalesce(search_text, '')), 100);
  result jsonb;
  row_total integer;
begin
  if private.platform_access() <> 'ready' then
    raise exception 'Platform owner verification required' using errcode = '42501';
  end if;
  if export_format is null or export_format not in ('csv', 'xlsx', 'pdf') then
    raise exception 'Choose Excel, CSV or PDF' using errcode = '22023';
  end if;
  with selected as (
    select o.id, o.name, o.slug, o.timezone, o.created_at
    from public.organizations o
    where term = '' or o.name ilike '%' || term || '%' or o.slug ilike '%' || term || '%'
    order by o.created_at, o.id
    limit 5000
  ), rows as (
    -- One aggregate pass per source table and organization.
    select s.*,
      m.administrators, m.technicians, m.employees, m.inactive_members,
      t.tickets_total, t.tickets_open, t.tickets_last_30_days, t.last_ticket_activity_at,
      (select count(*) from public.chat_conversations c where c.organization_id = s.id) as chats_total,
      (select count(*) from public.assets a where a.organization_id = s.id) as assets_total
    from selected s
    cross join lateral (
      select
        count(*) filter (where status = 'active' and role = 'administrator') as administrators,
        count(*) filter (where status = 'active' and role = 'technician') as technicians,
        count(*) filter (where status = 'active' and role = 'end_user') as employees,
        count(*) filter (where status <> 'active') as inactive_members
      from public.organization_memberships where organization_id = s.id
    ) m
    cross join lateral (
      select
        count(*) as tickets_total,
        count(*) filter (where status not in ('resolved', 'closed')) as tickets_open,
        count(*) filter (where created_at >= now() - interval '30 days') as tickets_last_30_days,
        max(updated_at) as last_ticket_activity_at
      from public.tickets where organization_id = s.id
    ) t
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb), count(*)
    into result, row_total
  from rows r;
  insert into private.platform_audit(actor_id, organization_id, action, details)
  values (auth.uid(), null, 'organizations_exported', jsonb_build_object(
    'format', export_format,
    'search', nullif(term, ''),
    'organizations', row_total::text
  ));
  return jsonb_build_object('generatedAt', now(), 'search', term, 'organizations', result,
    'matchingCount', (select count(*) from public.organizations o
      where term = '' or o.name ilike '%' || term || '%' or o.slug ilike '%' || term || '%'));
end $$;
revoke all on function private.platform_organization_export(text, text) from public, anon, service_role;
grant execute on function private.platform_organization_export(text, text) to authenticated;
create function public.platform_organization_export(search_text text default '', export_format text default 'csv')
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.platform_organization_export(search_text, export_format)
$$;
revoke all on function public.platform_organization_export(text, text) from public, anon, service_role;
grant execute on function public.platform_organization_export(text, text) to authenticated;
