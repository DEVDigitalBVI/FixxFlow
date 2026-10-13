-- Guided custom reports, saved definitions, and durable scheduled delivery.
-- Definitions are constrained JSON rather than executable SQL.

create function private.valid_custom_report_config(config jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  report_type text;
  selected_group text;
  selected_interval text;
  start_date date;
  end_date date;
  metric text;
  filter_key text;
  filter_value jsonb;
begin
  if config is null or jsonb_typeof(config) <> 'object'
    or (config - array['reportType','startDate','endDate','interval','groupBy','metrics','filters']) <> '{}'::jsonb
    or not (config ?& array['reportType','startDate','endDate','interval','groupBy','metrics','filters']) then return false; end if;
  report_type := config->>'reportType';
  selected_group := config->>'groupBy';
  selected_interval := config->>'interval';
  if report_type not in ('volume','turnaround','sla','backlog')
    or selected_group not in ('time','status','priority','category','subcategory','team','technician','department','location')
    or selected_interval not in ('day','week','month') then return false; end if;
  start_date := (config->>'startDate')::date;
  end_date := (config->>'endDate')::date;
  if end_date < start_date or end_date - start_date > 365 or start_date < date '2000-01-01' or end_date > current_date + 1 then return false; end if;
  if report_type = 'backlog' and selected_group = 'time' then return false; end if;
  if jsonb_typeof(config->'metrics') <> 'array' or jsonb_array_length(config->'metrics') not between 1 and 3 then return false; end if;
  for metric in select jsonb_array_elements_text(config->'metrics') loop
    if (report_type='volume' and metric not in ('created','resolved','reopened'))
      or (report_type='turnaround' and metric not in ('response_time','resolution_time'))
      or (report_type='sla' and metric not in ('response_sla','resolution_sla'))
      or (report_type='backlog' and metric not in ('open','overdue')) then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(config->'metrics')) <>
    (select count(distinct value) from jsonb_array_elements_text(config->'metrics')) then return false; end if;
  if jsonb_typeof(config->'filters') <> 'object'
    or ((config->'filters') - array['statuses','priorities','categoryIds','subcategoryIds','teamIds','technicianIds','departmentIds','locationIds']) <> '{}'::jsonb then return false; end if;
  for filter_key, filter_value in select key,value from jsonb_each(config->'filters') loop
    if jsonb_typeof(filter_value) <> 'array' or jsonb_array_length(filter_value) > 20 then return false; end if;
    if filter_key='statuses' and exists(select 1 from jsonb_array_elements_text(filter_value) value where value not in ('new','open','in_progress','waiting_on_user','on_hold','resolved','closed')) then return false; end if;
    if filter_key='priorities' and exists(select 1 from jsonb_array_elements_text(filter_value) value where value not in ('low','normal','high','critical')) then return false; end if;
    if filter_key not in ('statuses','priorities') and exists(select 1 from jsonb_array_elements_text(filter_value) value where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null,
  name text not null check(char_length(trim(name)) between 2 and 120),
  description text check(description is null or char_length(trim(description)) between 1 and 500),
  visibility text not null default 'personal' check(visibility in ('personal','shared')),
  definition jsonb not null check(private.valid_custom_report_config(definition)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,owner_id) references public.organization_memberships(organization_id,user_id)
);
create index saved_reports_organization_updated_idx on public.saved_reports(organization_id,updated_at desc);
create index saved_reports_owner_idx on public.saved_reports(organization_id,owner_id,updated_at desc);
create trigger saved_reports_set_updated_at before update on public.saved_reports for each row execute function private.set_updated_at();
alter table public.saved_reports enable row level security;

create policy "Staff can view available saved reports" on public.saved_reports for select to authenticated
using ((select private.can_work_tickets(organization_id)) and (visibility='shared' or owner_id=(select auth.uid())));
create policy "Staff can create saved reports" on public.saved_reports for insert to authenticated
with check ((select private.can_work_tickets(organization_id)) and owner_id=(select auth.uid())
  and (visibility='personal' or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
create policy "Owners and administrators can update saved reports" on public.saved_reports for update to authenticated
using ((select private.can_work_tickets(organization_id)) and (owner_id=(select auth.uid()) or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))))
with check ((select private.can_work_tickets(organization_id)) and (owner_id=(select auth.uid()) or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[])))
  and (visibility='personal' or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
create policy "Owners and administrators can delete saved reports" on public.saved_reports for delete to authenticated
using ((select private.can_work_tickets(organization_id)) and (owner_id=(select auth.uid()) or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
revoke all on public.saved_reports from public,anon;
grant select,insert,update,delete on public.saved_reports to authenticated;

create function private.next_report_run(frequency text,weekday integer,monthday integer,run_hour integer,zone text,after_time timestamptz)
returns timestamptz language plpgsql stable set search_path='' as $$
declare local_after timestamp:=after_time at time zone zone; candidate timestamp; first_month date;
begin
  if frequency='weekly' then
    candidate:=date_trunc('day',local_after)+make_interval(days=>((weekday-extract(dow from local_after)::integer)+7)%7,hours=>run_hour);
    if candidate<=local_after then candidate:=candidate+interval '7 days'; end if;
  elsif frequency='monthly' then
    first_month:=date_trunc('month',local_after)::date;
    candidate:=first_month+make_interval(days=>least(monthday,extract(day from (first_month+interval '1 month-1 day'))::integer)-1,hours=>run_hour);
    if candidate<=local_after then
      first_month:=(first_month+interval '1 month')::date;
      candidate:=first_month+make_interval(days=>least(monthday,extract(day from (first_month+interval '1 month-1 day'))::integer)-1,hours=>run_hour);
    end if;
  else raise exception 'Invalid report frequency' using errcode='22023'; end if;
  return candidate at time zone zone;
end $$;

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_id uuid not null,
  created_by uuid not null,
  frequency text not null check(frequency in ('weekly','monthly')),
  weekday integer check(weekday between 0 and 6),
  monthday integer check(monthday between 1 and 31),
  run_hour integer not null check(run_hour between 0 and 23),
  timezone text not null,
  format text not null default 'xlsx' check(format in ('xlsx','csv','pdf')),
  recipient_emails text[] not null check(cardinality(recipient_emails) between 1 and 20),
  active boolean not null default true,
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,report_id) references public.saved_reports(organization_id,id) on delete cascade,
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id),
  check((frequency='weekly' and weekday is not null and monthday is null) or (frequency='monthly' and weekday is null and monthday is not null))
);
create index report_schedules_due_idx on public.report_schedules(next_run_at,id) where active;

create function private.prepare_report_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare email text;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid report timezone' using errcode='23514'; end if;
  foreach email in array new.recipient_emails loop
    if email<>lower(trim(email)) or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(email)>254 then raise exception 'Invalid report recipient' using errcode='23514'; end if;
  end loop;
  if cardinality(new.recipient_emails)<>(select count(distinct value) from unnest(new.recipient_emails) value) then raise exception 'Duplicate report recipient' using errcode='23514'; end if;
  if tg_op='INSERT' or row(new.frequency,new.weekday,new.monthday,new.run_hour,new.timezone,new.active)
    is distinct from row(old.frequency,old.weekday,old.monthday,old.run_hour,old.timezone,old.active) then
    new.next_run_at:=private.next_report_run(new.frequency,new.weekday,new.monthday,new.run_hour,new.timezone,now());
  end if;
  return new;
end $$;
create trigger report_schedules_prepare before insert or update on public.report_schedules for each row execute function private.prepare_report_schedule();
create trigger report_schedules_set_updated_at before update on public.report_schedules for each row execute function private.set_updated_at();
alter table public.report_schedules enable row level security;
create policy "Administrators can view report schedules" on public.report_schedules for select to authenticated
using ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
create policy "Administrators can create report schedules" on public.report_schedules for insert to authenticated
with check (created_by=(select auth.uid()) and (select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
create policy "Administrators can update report schedules" on public.report_schedules for update to authenticated
using ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
create policy "Administrators can delete report schedules" on public.report_schedules for delete to authenticated
using ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));
revoke all on public.report_schedules from public,anon;
grant select,insert,update,delete on public.report_schedules to authenticated;

create function private.record_report_audit_event() returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  current_row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid:=(current_row->>'organization_id')::uuid; actor uuid:=auth.uid(); actor_name text; label text; fields text[]; field text;
  before_value jsonb; after_value jsonb; delta jsonb:='[]'::jsonb;
begin
  select display_name into actor_name from public.profiles where organization_id=org and user_id=actor;
  actor_name:=coalesce(actor_name,case when actor is null then 'System' else 'Member '||actor::text end);
  if tg_table_name='saved_reports' then label:=current_row->>'name';fields:=array['name','description','visibility','definition'];
  else select name into label from public.saved_reports where organization_id=org and id=(current_row->>'report_id')::uuid;
    fields:=array['frequency','weekday','monthday','run_hour','timezone','format','recipient_emails','active']; end if;
  foreach field in array fields loop
    before_value:=case when tg_op='INSERT' then 'null'::jsonb else previous->field end;
    after_value:=case when tg_op='DELETE' then 'null'::jsonb else current_row->field end;
    if before_value is distinct from after_value then
      if field='definition' then before_value:=case when before_value is null or before_value='null'::jsonb then 'null'::jsonb else '"Previous definition"'::jsonb end;after_value:=case when after_value is null or after_value='null'::jsonb then 'null'::jsonb else '"Definition updated"'::jsonb end;
      elsif field='recipient_emails' then before_value:=to_jsonb(case when before_value is null or before_value='null'::jsonb then 0 else jsonb_array_length(before_value) end);after_value:=to_jsonb(case when after_value is null or after_value='null'::jsonb then 0 else jsonb_array_length(after_value) end);field:='recipient_count'; end if;
      delta:=delta||jsonb_build_array(jsonb_build_object('field',field,'from',before_value,'to',after_value));
    end if;
  end loop;
  if tg_op='UPDATE' and jsonb_array_length(delta)=0 then return new; end if;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_name,tg_table_name,(current_row->>'id')::uuid,coalesce(label,'Report'),case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.record_report_audit_event() from public,anon,authenticated,service_role;
create trigger saved_reports_record_audit after insert or update or delete on public.saved_reports for each row execute function private.record_report_audit_event();
create trigger report_schedules_record_audit after insert or update or delete on public.report_schedules for each row execute function private.record_report_audit_event();

create table private.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null,
  report_id uuid not null,
  report_name text not null,
  definition jsonb not null,
  recipient_email text not null,
  format text not null check(format in ('xlsx','csv','pdf')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check(status in ('pending','leased','sent','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  error_code text,
  snapshot_at timestamptz,
  summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(schedule_id,scheduled_for,recipient_email),
  foreign key(organization_id,schedule_id) references public.report_schedules(organization_id,id) on delete cascade,
  foreign key(organization_id,report_id) references public.saved_reports(organization_id,id) on delete cascade,
  check((status='leased')=(lease_token is not null and lease_expires_at is not null)),
  check((status in ('sent','failed'))=(completed_at is not null))
);
create index report_deliveries_ready_idx on private.report_deliveries(available_at,id) where status in ('pending','leased');
alter table private.report_deliveries enable row level security;
revoke all on private.report_deliveries from public,anon,authenticated,service_role;

-- Compute a constrained report with the caller's tenant authorization. Service
-- access is reserved for the scheduled-delivery worker.
create function public.custom_report(target_organization_id uuid,report_config jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  report_now timestamptz:=now(); report_timezone text; report_type text; selected_group text; selected_interval text;
  start_date date; end_date date; start_at timestamptz; end_at timestamptz; selected_metrics text[];
  statuses text[]; priorities text[]; category_ids uuid[]; subcategory_ids uuid[]; team_ids uuid[]; technician_ids uuid[]; department_ids uuid[]; location_ids uuid[];
  result jsonb;
begin
  if current_setting('role',true)<>'service_role' and not exists(select 1 from public.organization_memberships m
    where m.organization_id=target_organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('administrator','technician'))
    then raise exception 'Staff access required' using errcode='42501'; end if;
  if not private.valid_custom_report_config(report_config) then raise exception 'Invalid report definition' using errcode='22023'; end if;
  select timezone into strict report_timezone from public.organizations where id=target_organization_id;
  report_type:=report_config->>'reportType'; selected_group:=report_config->>'groupBy'; selected_interval:=report_config->>'interval';
  start_date:=(report_config->>'startDate')::date; end_date:=(report_config->>'endDate')::date;
  start_at:=start_date::timestamp at time zone report_timezone; end_at:=(end_date+1)::timestamp at time zone report_timezone;
  select array_agg(value order by ordinality) into selected_metrics from jsonb_array_elements_text(report_config->'metrics') with ordinality;
  select coalesce(array_agg(value),'{}') into statuses from jsonb_array_elements_text(report_config->'filters'->'statuses');
  select coalesce(array_agg(value),'{}') into priorities from jsonb_array_elements_text(report_config->'filters'->'priorities');
  select coalesce(array_agg(value::uuid),'{}') into category_ids from jsonb_array_elements_text(report_config->'filters'->'categoryIds');
  select coalesce(array_agg(value::uuid),'{}') into subcategory_ids from jsonb_array_elements_text(report_config->'filters'->'subcategoryIds');
  select coalesce(array_agg(value::uuid),'{}') into team_ids from jsonb_array_elements_text(report_config->'filters'->'teamIds');
  select coalesce(array_agg(value::uuid),'{}') into technician_ids from jsonb_array_elements_text(report_config->'filters'->'technicianIds');
  select coalesce(array_agg(value::uuid),'{}') into department_ids from jsonb_array_elements_text(report_config->'filters'->'departmentIds');
  select coalesce(array_agg(value::uuid),'{}') into location_ids from jsonb_array_elements_text(report_config->'filters'->'locationIds');

  with base as materialized (
    select t.*, requester.department_id,
      coalesce(c.name,'Uncategorized') category_name,coalesce(sc.name,'No subcategory') subcategory_name,
      coalesce(team.name,'Unassigned team') team_name,coalesce(tech.display_name,'Unassigned') technician_name,
      coalesce(d.name,'No department') department_name,coalesce(l.name,'No location') location_name,
      case selected_group when 'status' then t.status::text when 'priority' then t.priority::text
        when 'category' then coalesce(t.category_id::text,'none') when 'subcategory' then coalesce(t.subcategory_id::text,'none')
        when 'team' then coalesce(t.team_id::text,'none') when 'technician' then coalesce(t.assigned_technician_id::text,'none')
        when 'department' then coalesce(requester.department_id::text,'none') when 'location' then coalesce(t.location_id::text,'none') else 'time' end group_key,
      case selected_group when 'status' then initcap(replace(t.status::text,'_',' ')) when 'priority' then case when t.priority='critical' then 'Urgent' else initcap(t.priority::text) end
        when 'category' then coalesce(c.name,'Uncategorized') when 'subcategory' then coalesce(sc.name,'No subcategory')
        when 'team' then coalesce(team.name,'Unassigned team') when 'technician' then coalesce(tech.display_name,'Unassigned')
        when 'department' then coalesce(d.name,'No department') when 'location' then coalesce(l.name,'No location') else 'Time' end group_label
    from public.tickets t
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.ticket_subcategories sc on sc.organization_id=t.organization_id and sc.id=t.subcategory_id
    left join public.teams team on team.organization_id=t.organization_id and team.id=t.team_id
    left join public.profiles tech on tech.organization_id=t.organization_id and tech.user_id=t.assigned_technician_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.locations l on l.organization_id=t.organization_id and l.id=t.location_id
    where t.organization_id=target_organization_id and t.created_at<=report_now
      and (cardinality(statuses)=0 or t.status::text=any(statuses)) and (cardinality(priorities)=0 or t.priority::text=any(priorities))
      and (cardinality(category_ids)=0 or t.category_id=any(category_ids)) and (cardinality(subcategory_ids)=0 or t.subcategory_id=any(subcategory_ids))
      and (cardinality(team_ids)=0 or t.team_id=any(team_ids)) and (cardinality(technician_ids)=0 or t.assigned_technician_id=any(technician_ids))
      and (cardinality(department_ids)=0 or requester.department_id=any(department_ids)) and (cardinality(location_ids)=0 or t.location_id=any(location_ids))
  ), status_events as materialized (
    select a.ticket_id,a.created_at,a.details->>'from' from_status,a.details->>'to' to_status
    from public.ticket_activity a join base b on b.id=a.ticket_id
    where a.organization_id=target_organization_id and a.action='status_changed' and a.created_at>=start_at and a.created_at<end_at
  ), metric_definitions(key,label,unit,description) as (values
    ('created','Created','tickets','Tickets created in the selected period.'),('resolved','Resolved','tickets','Distinct tickets resolved or closed in the selected period.'),
    ('reopened','Reopened','tickets','Distinct tickets returned to an active status in the selected period.'),('response_time','Average response','minutes','Average elapsed minutes to the first public staff response.'),
    ('resolution_time','Average resolution','minutes','Average elapsed minutes to the latest resolution.'),('response_sla','Response SLA','percent','Completed first-response targets met on time.'),
    ('resolution_sla','Resolution SLA','percent','Completed resolution targets met on time.'),('open','Open','tickets','All unresolved tickets in the current snapshot.'),
    ('overdue','Overdue','tickets','Unresolved tickets past a response or resolution SLA in the current snapshot.')
  ), raw as (
    select 'created' metric,b.group_key,b.group_label,b.created_at occurred_at,1::numeric amount,1 samples,b.id ticket_id from base b where b.created_at>=start_at and b.created_at<end_at
    union all select 'resolved',b.group_key,b.group_label,e.created_at,1,1,b.id from status_events e join base b on b.id=e.ticket_id where e.from_status not in ('resolved','closed') and e.to_status in ('resolved','closed')
    union all select 'reopened',b.group_key,b.group_label,e.created_at,1,1,b.id from status_events e join base b on b.id=e.ticket_id where e.from_status in ('resolved','closed') and e.to_status not in ('resolved','closed')
    union all select 'response_time',b.group_key,b.group_label,b.first_response_at,extract(epoch from (b.first_response_at-b.created_at))/60,1,b.id from base b where b.first_response_at>=start_at and b.first_response_at<end_at and b.first_response_at>=b.created_at
    union all select 'resolution_time',b.group_key,b.group_label,b.resolved_at,extract(epoch from (b.resolved_at-b.created_at))/60,1,b.id from base b where b.resolved_at>=start_at and b.resolved_at<end_at and b.resolved_at>=b.created_at
    union all select 'response_sla',b.group_key,b.group_label,b.first_response_at,case when b.first_response_at<=b.response_sla_due_at then 100 else 0 end,1,b.id from base b where b.first_response_at>=start_at and b.first_response_at<end_at and b.response_sla_due_at is not null
    union all select 'resolution_sla',b.group_key,b.group_label,b.resolved_at,case when b.resolved_at<=b.resolution_sla_due_at then 100 else 0 end,1,b.id from base b where b.resolved_at>=start_at and b.resolved_at<end_at and b.resolution_sla_due_at is not null
    union all select 'open',b.group_key,b.group_label,report_now,1,1,b.id from base b where b.status not in ('resolved','closed')
    union all select 'overdue',b.group_key,b.group_label,report_now,1,1,b.id from base b where b.status not in ('resolved','closed') and b.sla_next_due_at<=report_now
  ), selected_raw as (select * from raw where metric=any(selected_metrics)), normalized as (
    select metric,
      case when selected_group='time' then case selected_interval when 'day' then (occurred_at at time zone report_timezone)::date
        when 'week' then date_trunc('week',occurred_at at time zone report_timezone)::date else date_trunc('month',occurred_at at time zone report_timezone)::date end::text else group_key end bucket_key,
      case when selected_group='time' then case selected_interval when 'day' then to_char((occurred_at at time zone report_timezone)::date,'YYYY-MM-DD')
        when 'week' then 'Week of '||to_char(date_trunc('week',occurred_at at time zone report_timezone),'YYYY-MM-DD') else to_char(date_trunc('month',occurred_at at time zone report_timezone),'FMMonth YYYY') end else group_label end bucket_label,
      amount,samples,ticket_id from selected_raw
  ), aggregated as (
    select metric,bucket_key,min(bucket_label) bucket_label,
      case when metric in ('response_time','resolution_time','response_sla','resolution_sla') then avg(amount) else count(distinct ticket_id)::numeric end value,
      count(distinct ticket_id)::integer samples from normalized group by metric,bucket_key
  ), time_buckets as (
    select value::date bucket_start from generate_series(
      case selected_interval when 'day' then start_date::timestamp when 'week' then date_trunc('week',start_date::timestamp) else date_trunc('month',start_date::timestamp) end,
      case selected_interval when 'day' then end_date::timestamp when 'week' then date_trunc('week',end_date::timestamp) else date_trunc('month',end_date::timestamp) end,
      case selected_interval when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end) value where selected_group='time'
  ), row_keys as (
    select bucket_start::text bucket_key,case selected_interval when 'day' then to_char(bucket_start,'YYYY-MM-DD') when 'week' then 'Week of '||to_char(bucket_start,'YYYY-MM-DD') else to_char(bucket_start,'FMMonth YYYY') end bucket_label,bucket_start sort_date from time_buckets
    union select bucket_key,min(bucket_label),null::date from aggregated where selected_group<>'time' group by bucket_key
  ), report_rows as (
    select rk.bucket_key,rk.bucket_label,rk.sort_date,
      jsonb_object_agg(m.metric,case when a.value is null and m.metric in ('created','resolved','reopened','open','overdue') then to_jsonb(0) else to_jsonb(a.value) end order by m.ordinality) values,
      jsonb_object_agg(m.metric,coalesce(a.samples,0) order by m.ordinality) samples
    from row_keys rk cross join unnest(selected_metrics) with ordinality m(metric,ordinality)
    left join aggregated a on a.bucket_key=rk.bucket_key and a.metric=m.metric group by rk.bucket_key,rk.bucket_label,rk.sort_date
  ), summary_values as (
    select m.metric,d.label,d.unit,d.description,
      case when m.metric in ('response_time','resolution_time','response_sla','resolution_sla') then avg(r.amount)
        else count(distinct r.ticket_id)::numeric end value,count(distinct r.ticket_id)::integer samples,m.ordinality
    from unnest(selected_metrics) with ordinality m(metric,ordinality) join metric_definitions d on d.key=m.metric left join selected_raw r on r.metric=m.metric
    group by m.metric,d.label,d.unit,d.description,m.ordinality
  )
  select jsonb_build_object('asOf',report_now,'timezone',report_timezone,'startDate',start_date,'endDate',end_date,
    'reportType',report_type,'groupBy',selected_group,'interval',selected_interval,
    'metrics',(select jsonb_agg(jsonb_build_object('key',metric,'label',label,'unit',unit,'description',description) order by ordinality) from summary_values),
    'summary',(select jsonb_agg(jsonb_build_object('key',metric,'label',label,'unit',unit,'value',value,'samples',samples) order by ordinality) from summary_values),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('key',bucket_key,'label',bucket_label,'values',values,'samples',samples) order by sort_date nulls last,bucket_label) from report_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.custom_report(uuid,jsonb) from public,anon;
grant execute on function public.custom_report(uuid,jsonb) to authenticated,service_role;

create function public.enqueue_scheduled_report_deliveries()
returns integer language plpgsql security definer set search_path='' as $$
declare schedule public.report_schedules%rowtype; report public.saved_reports%rowtype; recipient text; added integer:=0; scheduled_time timestamptz;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  for schedule in select * from public.report_schedules where active and next_run_at<=now() order by next_run_at,id limit 25 for update skip locked loop
    scheduled_time:=schedule.next_run_at;
    select * into report from public.saved_reports where organization_id=schedule.organization_id and id=schedule.report_id;
    if found then foreach recipient in array schedule.recipient_emails loop
      insert into private.report_deliveries(organization_id,schedule_id,report_id,report_name,definition,recipient_email,format,scheduled_for)
      values(schedule.organization_id,schedule.id,report.id,report.name,report.definition,recipient,schedule.format,scheduled_time) on conflict do nothing;
      if found then added:=added+1; end if;
    end loop; end if;
    update public.report_schedules set last_enqueued_at=scheduled_time,
      next_run_at=private.next_report_run(schedule.frequency,schedule.weekday,schedule.monthday,schedule.run_hour,schedule.timezone,scheduled_time+interval '1 second') where id=schedule.id;
  end loop;
  return added;
end $$;

create function public.claim_report_deliveries(batch_size integer default 3,lease_seconds integer default 120)
returns table(delivery_id uuid,lease_token uuid,organization_id uuid,report_id uuid,report_name text,definition jsonb,recipient_email text,format text,scheduled_for timestamptz,attempts integer)
language plpgsql security definer set search_path='' as $$
declare item private.report_deliveries%rowtype; token uuid; stamp timestamptz:=clock_timestamp();
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if batch_size not between 1 and 10 or lease_seconds not between 30 and 300 then raise exception 'Invalid claim parameters' using errcode='22023'; end if;
  for item in select * from private.report_deliveries where status in ('pending','leased') and available_at<=stamp
    and (status='pending' or lease_expires_at<=stamp) order by available_at,id limit batch_size for update skip locked loop
    if item.attempts>=5 then update private.report_deliveries set status='failed',completed_at=stamp,error_code='retry_exhausted',lease_token=null,lease_expires_at=null where id=item.id; continue; end if;
    token:=gen_random_uuid();
    update private.report_deliveries set status='leased',attempts=private.report_deliveries.attempts+1,lease_token=token,lease_expires_at=stamp+make_interval(secs=>lease_seconds),available_at=stamp+make_interval(secs=>lease_seconds) where id=item.id;
    return query select item.id,token,item.organization_id,item.report_id,item.report_name,item.definition,item.recipient_email,item.format,item.scheduled_for,item.attempts+1;
  end loop;
end $$;

create function public.finish_report_delivery(target_id uuid,token uuid,provider_id text,failure_code text,snapshot timestamptz,report_summary jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare item private.report_deliveries%rowtype; stamp timestamptz:=clock_timestamp();
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if (provider_id is null)=(failure_code is null) or failure_code is not null and failure_code not in ('render_failed','provider_failed','configuration_error') then raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  select * into item from private.report_deliveries where id=target_id for update;
  if not found or item.status<>'leased' or item.lease_token is distinct from token or item.lease_expires_at<=stamp then return false; end if;
  if provider_id is not null then update private.report_deliveries set status='sent',provider_message_id=provider_id,error_code=null,snapshot_at=snapshot,summary=report_summary,completed_at=stamp,lease_token=null,lease_expires_at=null where id=target_id;
  elsif item.attempts>=5 then update private.report_deliveries set status='failed',error_code=failure_code,completed_at=stamp,lease_token=null,lease_expires_at=null where id=target_id;
  else update private.report_deliveries set status='pending',error_code=failure_code,available_at=stamp+make_interval(secs=>least(3600,30*power(2,item.attempts-1))::integer),lease_token=null,lease_expires_at=null where id=target_id; end if;
  return true;
end $$;

create function public.report_delivery_history(target_report_id uuid)
returns table(id uuid,recipient_email text,format text,status text,attempts integer,scheduled_for timestamptz,snapshot_at timestamptz,completed_at timestamptz,error_code text)
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
  select r.organization_id into org from public.saved_reports r where r.id=target_report_id;
  if org is null or not private.has_organization_role(org,array['administrator']::public.app_role[]) then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select d.id,d.recipient_email,d.format,d.status,d.attempts,d.scheduled_for,d.snapshot_at,d.completed_at,d.error_code from private.report_deliveries d
    where d.organization_id=org and d.report_id=target_report_id order by d.scheduled_for desc,d.recipient_email limit 100;
end $$;

revoke all on function private.valid_custom_report_config(jsonb),private.next_report_run(text,integer,integer,integer,text,timestamptz),private.prepare_report_schedule() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_scheduled_report_deliveries(),public.claim_report_deliveries(integer,integer),public.finish_report_delivery(uuid,uuid,text,text,timestamptz,jsonb),public.report_delivery_history(uuid) from public,anon;
grant execute on function public.enqueue_scheduled_report_deliveries(),public.claim_report_deliveries(integer,integer),public.finish_report_delivery(uuid,uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.report_delivery_history(uuid) to authenticated;
grant execute on function private.valid_custom_report_config(jsonb) to authenticated,service_role;
