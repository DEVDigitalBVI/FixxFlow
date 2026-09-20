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
    on delete set null,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id)
    on delete set null
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

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_active_organization_member(uuid) from public, anon;
revoke all on function private.has_organization_role(uuid, public.app_role[]) from public, anon;
grant execute on function private.is_active_organization_member(uuid) to authenticated;
grant execute on function private.has_organization_role(uuid, public.app_role[]) to authenticated;

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

grant select, update on public.organizations to authenticated;
grant select, update on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update on public.profiles to authenticated;

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
  and (select private.is_active_organization_member(
    (storage.foldername(name))[1]::uuid
  ))
);

create policy "Members can upload their own profile photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_active_organization_member(
    (storage.foldername(name))[1]::uuid
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
  and (select private.is_active_organization_member(
    (storage.foldername(name))[1]::uuid
  ))
);

create policy "Members can delete their own profile photo"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.is_active_organization_member(
    (storage.foldername(name))[1]::uuid
  ))
);
