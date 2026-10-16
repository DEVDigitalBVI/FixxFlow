begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

insert into public.organizations (id, name, slug) values
  ('20000000-0000-0000-0000-000000000021', 'Category test', 'starter-category-test'),
  ('20000000-0000-0000-0000-000000000022', 'Category isolation test', 'starter-category-isolation-test');

select extensions.results_eq(
  $$select name from public.ticket_categories where organization_id = '20000000-0000-0000-0000-000000000021' order by name$$,
  $$select name from (values ('Account / Access'), ('Computer'), ('Email'), ('Network'), ('Printer'), ('Software'), ('Security'), ('Phone'), ('Other')) categories(name) order by name$$,
  'new organizations receive exactly the nine starter categories'
);
select extensions.is(
  (select count(*)::integer from public.teams where organization_id = '20000000-0000-0000-0000-000000000021' and name = 'IT Support'),
  1, 'the existing IT Support team seed is preserved'
);
select extensions.is(
  (select count(*)::integer from public.ticket_subcategories where organization_id = '20000000-0000-0000-0000-000000000021'),
  0, 'starter taxonomy does not impose subcategories'
);
select extensions.is(
  (select count(*)::integer from public.ticket_categories where organization_id = '20000000-0000-0000-0000-000000000022'),
  9, 'each organization receives its own category records'
);
select extensions.throws_ok(
  $$insert into public.ticket_subcategories (organization_id, category_id, name)
    select '20000000-0000-0000-0000-000000000022', id, 'Mailbox'
    from public.ticket_categories
    where organization_id = '20000000-0000-0000-0000-000000000021' and name = 'Email'$$,
  '23503', null, 'a subcategory cannot use a category from a different organization'
);
-- Replay the migration's idempotent backfill statement. Supabase runs pgTAP in a
-- container that mounts the test directory but not the migrations directory, so
-- this must stay self-contained instead of using psql's \ir command.
create temporary table original_email as
select id from public.ticket_categories
where organization_id = '20000000-0000-0000-0000-000000000021' and name = 'Email';
update public.ticket_categories set is_active = false where id in (select id from original_email);
insert into public.ticket_categories (organization_id, name)
values ('20000000-0000-0000-0000-000000000021', 'Custom category');
insert into public.ticket_categories (organization_id, name)
select organization.id, category.name
from public.organizations organization
cross join (values
  ('Account / Access'), ('Computer'), ('Email'), ('Network'), ('Printer'),
  ('Software'), ('Security'), ('Phone'), ('Other')
) category(name)
on conflict (organization_id, name) do nothing;
select extensions.is(
  (select count(*)::integer from public.ticket_categories where organization_id = '20000000-0000-0000-0000-000000000021'),
  10, 'backfill is idempotent and preserves custom categories'
);
select extensions.is(
  (select id from public.ticket_categories where organization_id = '20000000-0000-0000-0000-000000000021' and name = 'Email'),
  (select id from original_email), 'backfill preserves existing category IDs'
);
select extensions.is(
  (select is_active from public.ticket_categories where id in (select id from original_email)),
  false, 'backfill does not reactivate a disabled default'
);
select * from extensions.finish();
rollback;
