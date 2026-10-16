-- A deterministic administrator for legacy transactional regression files that
-- were originally written to run against a populated developer database.
insert into auth.users (id, email, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000001',
  'database-regression-admin@example.invalid',
  now()
)
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values (
  '10000000-0000-0000-0000-000000000001',
  'Database regression organization',
  'database-regression-organization'
)
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, user_id, role, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'administrator',
  'active'
)
on conflict (organization_id, user_id) do update
set role = excluded.role, status = excluded.status;

insert into public.profiles (organization_id, user_id, display_name, email)
values (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Database Regression Administrator',
  'database-regression-admin@example.invalid'
)
on conflict (organization_id, user_id) do nothing;
