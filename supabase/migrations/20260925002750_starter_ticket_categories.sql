-- Seed the starter taxonomy without renaming categories referenced by historical tickets.
-- Existing inactive defaults stay inactive; custom categories and subcategories stay intact.
create or replace function private.seed_ticket_configuration()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.teams (organization_id, name, description)
  values (new.id, 'IT Support', 'Primary service desk team') on conflict do nothing;
  insert into public.ticket_categories (organization_id, name)
  select new.id, category_name from (values
    ('Account / Access'), ('Computer'), ('Email'), ('Network'), ('Printer'),
    ('Software'), ('Security'), ('Phone'), ('Other')
  ) categories(category_name)
  on conflict (organization_id, name) do nothing;
  return new;
end;
$$;

insert into public.ticket_categories (organization_id, name)
select organization.id, category.name
from public.organizations organization
cross join (values
  ('Account / Access'), ('Computer'), ('Email'), ('Network'), ('Printer'),
  ('Software'), ('Security'), ('Phone'), ('Other')
) category(name)
on conflict (organization_id, name) do nothing;
