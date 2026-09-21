create or replace function public.bootstrap_organization(
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
    or not exists (
      select 1 from auth.users
      where id = administrator_user_id and email_confirmed_at is not null
    ) then
    raise exception 'A verified administrator account is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fixxflow-organization-bootstrap-' || administrator_user_id::text, 0)
  );

  if exists (
    select 1 from public.organization_memberships
    where user_id = administrator_user_id
  ) then
    raise exception 'This account already belongs to an organization';
  end if;

  if char_length(trim(organization_name)) not between 2 and 120
    or organization_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(organization_slug) not between 2 and 63
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

revoke all on function public.bootstrap_organization(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text, text, text, uuid)
  to service_role;
