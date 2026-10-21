-- Intake and ownership alerts are ready for the next dispatcher run.
-- Routine replies retain their default delay and coalescing; updates/retries
-- never invoke this trigger, preserving delivery backoff and active leases.
create function private.prepare_notification_email_timing() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if exists (select 1 from public.notifications n where n.id=new.notification_id
   and n.kind in ('ticket_created','ticket_assigned','ticket_reassigned')) then
   new.available_at := now();
 end if;
 return new;
end;
$$;
revoke all on function private.prepare_notification_email_timing() from public,anon,authenticated;
create trigger notification_email_initial_timing before insert on private.notification_email_outbox
for each row execute function private.prepare_notification_email_timing();
