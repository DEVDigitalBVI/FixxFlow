begin;

-- Match the existing ticket and asset foreign keys: deleting organization data
-- must never silently clear a person's department or location.
-- NO ACTION is immediate (not deferrable) and still permits whole-organization
-- cascades that remove both the reference and its parent in the same statement.
alter table public.profiles
  drop constraint profiles_organization_id_department_id_fkey,
  add constraint profiles_organization_id_department_id_fkey
    foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete no action,
  drop constraint profiles_organization_id_location_id_fkey,
  add constraint profiles_organization_id_location_id_fkey
    foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete no action;

commit;
