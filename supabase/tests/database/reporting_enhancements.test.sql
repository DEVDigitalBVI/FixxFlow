begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000851','report-admin-851@example.invalid'),
 ('10000000-0000-0000-0000-000000000852','report-employee-852@example.invalid'),
 ('10000000-0000-0000-0000-000000000853','report-foreign-853@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000851','Reporting check A','reporting-check-a-851'),
 ('20000000-0000-0000-0000-000000000852','Reporting check B','reporting-check-b-852');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000851','administrator'),
 ('20000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000852','end_user'),
 ('20000000-0000-0000-0000-000000000852','10000000-0000-0000-0000-000000000853','administrator');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000851","role":"authenticated","aal":"aal1"}',true);
insert into public.tickets(organization_id,requester_id,title,description,status,assigned_technician_id) values
 ('20000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000852','Reporting fixture','Request','waiting_on_user','10000000-0000-0000-0000-000000000851'),
 ('20000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000852','Unassigned reporting fixture','Request','open',null);
select extensions.is((select sum(open_count)::int from public.technician_workload('20000000-0000-0000-0000-000000000851')),2,'workload counts current open tickets');
select extensions.is((select waiting_count::int from public.technician_workload('20000000-0000-0000-0000-000000000851') where user_id='10000000-0000-0000-0000-000000000851'),1,'waiting is a subset of open');
select extensions.is((select open_count::int from public.technician_workload('20000000-0000-0000-0000-000000000851') where user_id is null),1,'unassigned work stays visible');
select extensions.is((select count(*)::int from public.technician_workload('20000000-0000-0000-0000-000000000852')),0,'organization argument does not bypass membership');
insert into public.saved_reports(id,organization_id,owner_id,name,visibility,definition) values
 ('60000000-0000-0000-0000-000000000851','20000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000851','Daily report','shared','{"reportType":"volume","startDate":"2026-10-01","endDate":"2026-10-28","interval":"day","groupBy":"time","metrics":["created"],"filters":{"statuses":[],"priorities":[],"categoryIds":[],"subcategoryIds":[],"teamIds":[],"technicianIds":[],"departmentIds":[],"locationIds":[]}}');
select extensions.lives_ok($$insert into public.report_schedules(id,organization_id,report_id,created_by,frequency,run_hour,timezone,recipient_emails) values('70000000-0000-0000-0000-000000000851','20000000-0000-0000-0000-000000000851','60000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000851','daily',8,'America/Tortola',array['reports@example.invalid'])$$,'administrator can schedule daily delivery');
select extensions.is((select extract(hour from next_run_at at time zone 'America/Tortola')::int from public.report_schedules where id='70000000-0000-0000-0000-000000000851'),8,'daily delivery preserves the workspace hour');
select extensions.throws_ok($$update public.report_schedules set weekday=1 where id='70000000-0000-0000-0000-000000000851'$$,'23514',null,'daily delivery has no weekday restriction');
select extensions.throws_ok($$update public.report_schedules set frequency='hourly' where id='70000000-0000-0000-0000-000000000851'$$,'22023',null,'unsupported frequency is rejected');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000852","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::int from public.technician_workload('20000000-0000-0000-0000-000000000851')),0,'employee cannot read reporting workload');
select extensions.throws_ok($$insert into public.report_schedules(organization_id,report_id,created_by,frequency,run_hour,timezone,recipient_emails) values('20000000-0000-0000-0000-000000000851','60000000-0000-0000-0000-000000000851','10000000-0000-0000-0000-000000000852','daily',8,'America/Tortola',array['employee@example.invalid'])$$,'42501',null,'employee cannot create a daily schedule');
reset role;
select extensions.is(private.next_report_run('daily',null,null,1,'America/New_York','2026-11-01 05:30:00+00'), '2026-11-01 06:00:00+00'::timestamptz,'fall-back hour resolves once to the standard-time occurrence');
select extensions.is(private.next_report_run('daily',null,null,2,'America/New_York','2026-03-08 06:00:00+00'), '2026-03-08 07:00:00+00'::timestamptz,'spring-forward missing hour maps safely');
select * from extensions.finish();
rollback;
