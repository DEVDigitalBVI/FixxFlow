-- Apply impact before tickets_sla_prepare calculates both deadlines.
-- Creation only: staff priority adjustments and historical tickets are preserved.
create function private.apply_initial_impact_priority()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.priority := case new.reported_impact
    when 'minor_inconvenience' then 'low'::public.ticket_priority
    when 'work_blocked' then 'normal'::public.ticket_priority
    when 'team_affected' then 'high'::public.ticket_priority
    when 'operations_stopped' then 'critical'::public.ticket_priority
    else new.priority end;
  return new;
end;
$$;
revoke all on function private.apply_initial_impact_priority() from public, anon, authenticated;
create trigger tickets_b_initial_impact_priority before insert on public.tickets
for each row execute function private.apply_initial_impact_priority();
