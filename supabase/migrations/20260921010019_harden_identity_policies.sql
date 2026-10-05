create index profiles_organization_department_idx
  on public.profiles (organization_id, department_id)
  where department_id is not null;
create index profiles_organization_location_idx
  on public.profiles (organization_id, location_id)
  where location_id is not null;

drop function public.bootstrap_organization(text, text, text);
create function public.bootstrap_organization(
  organization_name text,
  organization_slug text,
  administrator_name text,
  administrator_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  if administrator_user_id is null
    or not exists (select 1 from auth.users where id = administrator_user_id) then
    raise exception 'A valid administrator account is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fixxflow-organization-bootstrap', 0));
  if exists (select 1 from public.organizations) then
    raise exception 'The initial organization has already been configured';
  end if;
  if char_length(trim(organization_name)) not between 2 and 120
    or organization_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(trim(administrator_name)) not between 1 and 120 then
    raise exception 'Organization setup details are invalid';
  end if;
  insert into public.organizations (name, slug)
  values (trim(organization_name), organization_slug)
  returning id into new_organization_id;
  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, administrator_user_id, 'administrator');
  insert into public.profiles (organization_id, user_id, display_name, email)
  select new_organization_id, administrator_user_id, trim(administrator_name), users.email
  from auth.users as users where users.id = administrator_user_id;
  return new_organization_id;
end;
$$;
revoke all on function public.bootstrap_organization(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text, text, text, uuid) to service_role;

drop policy "Members can view their own membership" on public.organization_memberships;
drop policy "Technicians and administrators can view organization members" on public.organization_memberships;
create policy "Members can view permitted memberships"
on public.organization_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_organization_role(
    organization_id,
    array['technician', 'administrator']::public.app_role[]
  ))
);

drop policy "Administrators can manage departments" on public.departments;
create policy "Administrators can insert departments" on public.departments for insert to authenticated
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can update departments" on public.departments for update to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can delete departments" on public.departments for delete to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));

drop policy "Administrators can manage locations" on public.locations;
create policy "Administrators can insert locations" on public.locations for insert to authenticated
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can update locations" on public.locations for update to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can delete locations" on public.locations for delete to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));

drop policy "Members can update their own profile" on public.profiles;
drop policy "Administrators can update organization profiles" on public.profiles;
create policy "Members and administrators can update permitted profiles"
on public.profiles for update to authenticated
using (
  (user_id = (select auth.uid()) and (select private.is_active_organization_member(organization_id)))
  or (select private.has_organization_role(organization_id, array['administrator']::public.app_role[]))
)
with check (
  (user_id = (select auth.uid()) and (select private.is_active_organization_member(organization_id)))
  or (select private.has_organization_role(organization_id, array['administrator']::public.app_role[]))
);
