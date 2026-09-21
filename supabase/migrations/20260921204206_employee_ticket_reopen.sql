create policy "Requesters can reopen resolved tickets" on public.tickets
for update to authenticated
using (
  requester_id = (select auth.uid())
  and (select private.is_active_organization_member(organization_id))
  and status in ('resolved', 'closed')
)
with check (
  requester_id = (select auth.uid())
  and (select private.is_active_organization_member(organization_id))
  and status = 'open'
);

create function private.restrict_employee_ticket_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not (select private.can_work_tickets(old.organization_id)) then
    if old.requester_id is distinct from (select auth.uid())
      or old.status not in ('resolved', 'closed')
      or new.status <> 'open'
      or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Only a resolved or closed request may be reopened';
    end if;
  end if;
  return new;
end;
$$;

create trigger tickets_a_restrict_employee_update
before update on public.tickets
for each row execute function private.restrict_employee_ticket_update();
