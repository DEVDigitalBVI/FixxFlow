begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'active-a@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'active-b@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'inactive-a@example.test');

insert into public.organizations (id, name, slug)
values
  ('20000000-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b');

insert into public.organization_memberships (organization_id, user_id, role, status, deactivated_at)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'end_user', 'active', null),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'administrator', 'active', null),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'end_user', 'inactive', now());

insert into public.profiles (organization_id, user_id, display_name)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Active A'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Active B'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Inactive A');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::integer from public.organizations), 1, 'active member sees only their organization');
select extensions.is((select count(*)::integer from public.profiles), 2, 'active member sees profiles only in their organization');
select extensions.is((select count(*)::integer from public.organization_memberships), 1, 'end user sees only their own membership');
select extensions.is((select count(*)::integer from public.organizations where id = '20000000-0000-0000-0000-000000000002'), 0, 'cross-organization read is denied');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::integer from public.organizations), 0, 'inactive member cannot read the organization');
select extensions.is((select count(*)::integer from public.profiles), 0, 'inactive member cannot read profiles');
select extensions.is((select count(*)::integer from public.organization_memberships), 1, 'inactive member can read only their own status record');
select extensions.is((select count(*)::integer from public.departments), 0, 'inactive member cannot read departments');

reset role;
select * from extensions.finish();
rollback;
