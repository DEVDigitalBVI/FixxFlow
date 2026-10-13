-- Supabase projects can have authenticated in their default function privileges.
-- The dispatcher RPCs are server infrastructure and must only be callable with
-- the service-role key, even though they also validate the caller internally.
revoke execute on function public.enqueue_scheduled_report_deliveries() from authenticated;
revoke execute on function public.claim_report_deliveries(integer,integer) from authenticated;
revoke execute on function public.finish_report_delivery(uuid,uuid,text,text,timestamptz,jsonb) from authenticated;

-- Cover tenant-scoped foreign keys used for cascades and integrity checks.
create index if not exists report_schedules_organization_report_idx
  on public.report_schedules(organization_id,report_id);
create index if not exists report_schedules_organization_creator_idx
  on public.report_schedules(organization_id,created_by);
create index if not exists report_deliveries_organization_schedule_idx
  on private.report_deliveries(organization_id,schedule_id);
create index if not exists report_deliveries_organization_report_idx
  on private.report_deliveries(organization_id,report_id);
