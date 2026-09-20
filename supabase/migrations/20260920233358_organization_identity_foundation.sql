create schema if not exists private;

create type public.app_role as enum ('end_user', 'technician', 'administrator');
create type public.membership_status as enum ('active', 'inactive');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'end_user',
  status public.membership_status not null default 'active',
  activated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint membership_deactivation_consistent check (
    (status = 'active' and deactivated_at is null)
    or (status = 'inactive' and deactivated_at is not null)
  )
);

create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id, status);
create index organization_memberships_org_role_idx
  on public.organization_memberships (organization_id, role)
  where status = 'active';

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create index departments_organization_id_idx on public.departments (organization_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  address_line_1 text,
  address_line_2 text,
  city text,
  region text,
  postal_code text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  timezone text not null default 'America/Tortola',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create index locations_organization_id_idx on public.locations (organization_id);

create table public.profiles (
  organization_id uuid not null,
  user_id uuid not null,
  department_id uuid,
  location_id uuid,
  display_name text not null check (char_length(display_name) between 1 and 120),
  job_title text,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id)
    on delete set null (department_id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id)
    on delete set null (location_id)
);

create index profiles_user_id_idx on public.profiles (user_id);
create index profiles_department_id_idx on public.profiles (department_id)
  where department_id is not null;
create index profiles_location_id_idx on public.profiles (location_id)
  where location_id is not null;

create or replace function private.is_active_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    );
$$;

create or replace function private.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
    );
$$;

create or replace function private.is_active_organization_member_path(target_organization_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id::text = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_active_organization_member(uuid) from public, anon;
revoke all on function private.has_organization_role(uuid, public.app_role[]) from public, anon;
revoke all on function private.is_active_organization_member_path(text) from public, anon;
grant execute on function private.is_active_organization_member(uuid) to authenticated;
grant execute on function private.has_organization_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.is_active_organization_member_path(text) to authenticated;

create or replace function public.bootstrap_organization(
  organization_name text,
  organization_slug text,
  administrator_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
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
  values (new_organization_id, current_user_id, 'administrator');

  insert into public.profiles (organization_id, user_id, display_name)
  values (new_organization_id, current_user_id, trim(administrator_name));

  return new_organization_id;
end;
$$;

revoke all on function public.bootstrap_organization(text, text, text) from public, anon;
grant execute on function public.bootstrap_organization(text, text, text) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
for each row execute function private.set_updated_at();
create trigger memberships_set_updated_at before update on public.organization_memberships
for each row execute function private.set_updated_at();
create trigger departments_set_updated_at before update on public.departments
for each row execute function private.set_updated_at();
create trigger locations_set_updated_at before update on public.locations
for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.protect_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'administrator'
    and old.status = 'active'
    and (new.role <> 'administrator' or new.status <> 'active')
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = old.organization_id
        and membership.user_id <> old.user_id
        and membership.role = 'administrator'
        and membership.status = 'active'
    ) then
    raise exception 'An organization must retain at least one active administrator';
  end if;
  return new;
end;
$$;

create trigger memberships_protect_last_administrator
before update of role, status on public.organization_memberships
for each row execute function private.protect_last_administrator();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.departments enable row level security;
alter table public.locations enable row level security;
alter table public.profiles enable row level security;

create policy "Active members can view their organization"
on public.organizations for select to authenticated
using ((select private.is_active_organization_member(id)));

create policy "Administrators can update their organization"
on public.organizations for update to authenticated
using ((select private.has_organization_role(id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(id, array['administrator']::public.app_role[])));

create policy "Members can view their own membership"
on public.organization_memberships for select to authenticated
using (user_id = (select auth.uid()));

create policy "Technicians and administrators can view organization members"
on public.organization_memberships for select to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['technician', 'administrator']::public.app_role[]
)));

create policy "Administrators can update organization members"
on public.organization_memberships for update to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)))
with check ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)));

create policy "Active members can view departments"
on public.departments for select to authenticated
using ((select private.is_active_organization_member(organization_id)));

create policy "Administrators can manage departments"
on public.departments for all to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)))
with check ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)));

create policy "Active members can view locations"
on public.locations for select to authenticated
using ((select private.is_active_organization_member(organization_id)));

create policy "Administrators can manage locations"
on public.locations for all to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)))
with check ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)));

create policy "Active members can view organization profiles"
on public.profiles for select to authenticated
using ((select private.is_active_organization_member(organization_id)));

create policy "Members can update their own profile"
on public.profiles for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_active_organization_member(organization_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_active_organization_member(organization_id))
);

create policy "Administrators can insert profiles"
on public.profiles for insert to authenticated
with check ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)));

create policy "Administrators can update organization profiles"
on public.profiles for update to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)))
with check ((select private.has_organization_role(
  organization_id,
  array['administrator']::public.app_role[]
)));

revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_memberships from anon, authenticated;
revoke all on public.departments from anon, authenticated;
revoke all on public.locations from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

grant select on public.organizations to authenticated;
grant update (name, slug, logo_path) on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant update (role, status, activated_at, deactivated_at) on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select on public.profiles to authenticated;
grant insert (organization_id, user_id, department_id, location_id, display_name, job_title, phone, avatar_path)
  on public.profiles to authenticated;
grant update (department_id, location_id, display_name, job_title, phone, avatar_path)
  on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Organization members can view profile photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (select private.is_active_organization_member_path(
    (storage.foldername(name))[1]
  ))
);

create policy "Members can upload their own profile photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_active_organization_member_path(
    (storage.foldername(name))[1]
  ))
);

create policy "Members can update their own profile photo"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_active_organization_member_path(
    (storage.foldername(name))[1]
  ))
);

create policy "Members can delete their own profile photo"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_active_organization_member_path(
    (storage.foldername(name))[1]
  ))
);
