-- Optional parent locations, computed paths and descendant-aware report filters.
SET local check_function_bodies = off;

ALTER TABLE "public"."locations"
  DROP CONSTRAINT "locations_organization_id_name_key";

ALTER TABLE "public"."locations"
  ADD COLUMN "parent_id" uuid;

CREATE OR REPLACE FUNCTION private.guard_location_hierarchy()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare cursor_id uuid; next_parent uuid; parent_active boolean; chain uuid[]; subtree_height integer;
begin
  if tg_op='UPDATE' and (new.id,new.organization_id) is distinct from (old.id,old.organization_id) then
    raise exception 'Location identity cannot change' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.parent_id,new.is_active) is not distinct from (old.parent_id,old.is_active) then return new; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Retry location hierarchy changes in a read committed transaction' using errcode='40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('location-hierarchy:'||new.organization_id::text,0));
  chain:=array[new.id]; cursor_id:=new.parent_id;
  while cursor_id is not null loop
    if cursor_id=any(chain) then raise exception 'A location cannot be its own ancestor' using errcode='23514'; end if;
    chain:=array_append(chain,cursor_id);
    select parent_id,is_active into next_parent,parent_active from public.locations
      where organization_id=new.organization_id and id=cursor_id;
    if not found then raise exception 'Parent location is unavailable in this organization' using errcode='23503'; end if;
    if new.is_active and not parent_active then raise exception 'Active locations need an active parent' using errcode='23514'; end if;
    cursor_id:=next_parent;
    if cardinality(chain)>8 then raise exception 'Use at most eight location levels' using errcode='23514'; end if;
  end loop;
  with recursive descendants(id,depth) as (
    select new.id,1 union all select l.id,d.depth+1 from public.locations l join descendants d on l.parent_id=d.id
      where l.organization_id=new.organization_id and d.depth<9
  ) select max(depth) into subtree_height from descendants;
  if cardinality(chain)+subtree_height-1>8 then raise exception 'Use at most eight location levels' using errcode='23514'; end if;
  if not new.is_active and exists(select 1 from public.locations where organization_id=new.organization_id and parent_id=new.id and is_active) then
    raise exception 'Deactivate or move active sublocations first' using errcode='23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.read_automation_admin (
  org          uuid,
  kind         text,
  query        text,
  state        text,
  trigger_type text,
  resource     text,
  target       uuid,
  selected     uuid[],
  page_number  integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare rows jsonb; patterns text[]:=private.search_patterns(query);
begin
  if auth.uid() is null or not private.has_required_assurance() or not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) then raise exception 'Administrator and assurance required' using errcode='42501'; end if;
  if page_number is null or page_number not between 1 and 100000 or coalesce(cardinality(selected),0)>100 then raise exception 'Invalid read request' using errcode='22023'; end if;
  if kind='list' then
    if state not in ('all','enabled','disabled','archived') or state is null then raise exception 'Invalid filter' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(data) order by data.updated_at desc,data.id),'[]') into rows from (
      select r.id,r.name,r.enabled,r.version,r.trigger_type,r.updated_at,r.archived_at,
        (select count(*) from public.automation_executions x where x.organization_id=org and x.rule_id=r.id) run_count,
        (select jsonb_build_object('started_at',x.started_at,'status',x.status,'error_code',x.error_code) from public.automation_executions x where x.organization_id=org and x.rule_id=r.id order by x.started_at desc,x.id desc limit 1) last_run
      from public.automation_rules r where r.organization_id=org and r.name ilike all(patterns)
        and (coalesce(read_automation_admin.trigger_type,'')='' or r.trigger_type=read_automation_admin.trigger_type)
        and case state when 'archived' then r.archived_at is not null when 'enabled' then r.archived_at is null and r.enabled when 'disabled' then r.archived_at is null and not r.enabled else r.archived_at is null end
      order by r.updated_at desc,r.id limit 51 offset (page_number-1)*50
    ) data;
    return jsonb_build_object('rows',rows,'processingActive',(select active from private.automation_processing_state));
  elsif kind='events' then
    if not exists(select 1 from public.tickets where organization_id=org and id=target) then raise exception 'Ticket unavailable' using errcode='P0002'; end if;
    select coalesce(jsonb_agg(to_jsonb(data) order by data.occurred_at desc,data.id desc),'[]') into rows from (
      select e.id,e.event_type,e.occurred_at,e.entity_version from private.domain_events e where e.organization_id=org and e.entity_type='ticket' and e.entity_id=target
      order by e.occurred_at desc,e.id desc limit 51 offset (page_number-1)*50
    ) data;
    return jsonb_build_object('rows',rows);
  elsif kind='choices' then
    if resource is null or resource not in ('active_ticket_workers','organization_memberships','teams','ticket_categories','ticket_subcategories','departments','locations','tickets') then raise exception 'Invalid resource' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(data) order by data.label,data.id),'[]') into rows from (
      select * from (
        select m.user_id id,coalesce(p.display_name,'Member without a profile') label,m.status='active' active,null::uuid "parentId"
        from public.organization_memberships m left join public.profiles p on (p.organization_id,p.user_id)=(m.organization_id,m.user_id)
        where m.organization_id=org and (resource='organization_memberships' or (resource='active_ticket_workers' and m.role in ('technician','administrator')))
        union all select id,name,is_active,null::uuid from public.teams where organization_id=org and resource='teams'
        union all select id,name,is_active,null::uuid from public.ticket_categories where organization_id=org and resource='ticket_categories'
        union all select s.id,c.name||' / '||s.name,s.is_active and c.is_active,s.category_id from public.ticket_subcategories s join public.ticket_categories c on (c.organization_id,c.id)=(s.organization_id,s.category_id) where s.organization_id=org and resource='ticket_subcategories'
        union all select id,name,is_active,null::uuid from public.departments where organization_id=org and resource='departments'
        union all select id,path,is_active,parent_id from public.location_paths where organization_id=org and resource='locations'
        union all select id,'Ticket #'||ticket_number||' · '||title,true,null::uuid from public.tickets where organization_id=org and resource='tickets'
      ) choices where case when cardinality(selected)>0 then id=any(selected) else label ilike all(patterns) end
      order by label,id limit case when cardinality(selected)>0 then 100 else 51 end offset case when cardinality(selected)>0 then 0 else (page_number-1)*50 end
    ) data;
    return jsonb_build_object('rows',rows);
  else raise exception 'Invalid read kind' using errcode='22023'; end if;
end $function$;

CREATE OR REPLACE FUNCTION private.record_audit_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  previous jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  current_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid; actor uuid := auth.uid(); actor_label text; target uuid; target_label text;
  fields text[]; key text; before_value jsonb; after_value jsonb; delta jsonb := '[]'::jsonb;
  ticket_number bigint;
begin
  org := case when tg_table_name='organizations' then (current_row->>'id')::uuid else (current_row->>'organization_id')::uuid end;
  target := coalesce(current_row->>'id',current_row->>'user_id')::uuid;
  -- Only the trusted service-role invitation RPC supplies an actor context.
  if actor is null and current_setting('role',true)='service_role' then
    actor := nullif(current_setting('app.audit_actor',true),'')::uuid;
  end if;
  select display_name into actor_label from public.profiles where organization_id=org and user_id=actor;
  actor_label := coalesce(actor_label,case when actor is null then 'System' else 'Member '||actor::text end);
  case tg_table_name
    when 'tickets' then fields:=array['title','description','status','priority','requester_id','assigned_technician_id','team_id','category_id','subcategory_id','location_id','due_at']; target_label:='Ticket #'||(current_row->>'ticket_number');
    when 'organization_memberships' then
      fields:=array['role','status'];
      select display_name into target_label from public.profiles where organization_id=org and user_id=target;
      if target_label is null and current_setting('role',true)='service_role' and current_row->>'user_id'=current_setting('app.audit_subject',true) then target_label:=nullif(current_setting('app.audit_subject_name',true),''); end if;
      target_label:=coalesce(target_label,'Member '||target::text);
    when 'organizations' then fields:=array['name','slug','logo_path']; target_label:=current_row->>'name';
    when 'profiles' then fields:=array['display_name','department_id','location_id']; target_label:=current_row->>'display_name';
    when 'departments' then fields:=array['name','description','is_active']; target_label:=current_row->>'name';
    when 'locations' then fields:=array['name','parent_id','timezone','is_active']; target_label:=current_row->>'name';
    when 'teams' then fields:=array['name','is_active']; target_label:=current_row->>'name';
    when 'ticket_categories' then fields:=array['name','is_active','default_team_id']; target_label:=current_row->>'name';
    when 'ticket_subcategories' then fields:=array['name','category_id','is_active']; target_label:=current_row->>'name';
    when 'knowledge_articles' then fields:=array['title','category','status','audience','content','related_article_ids']; target_label:=current_row->>'title';
    when 'chat_conversations' then fields:=array['status','assigned_technician_id','ticket_id']; target_label:='Chat '||left(target::text,8);
    when 'ticket_messages' then
      fields:=array['kind','body'];
      select t.ticket_number into ticket_number from public.tickets t where t.organization_id=org and t.id=(current_row->>'ticket_id')::uuid;
      target_label:=coalesce('Ticket #'||ticket_number,'Ticket')||case when current_row->>'kind'='internal_note' then ' · internal note' else ' · public reply' end;
    else raise exception 'Unsupported audit source';
  end case;
  foreach key in array fields loop
    before_value:=case when tg_op='INSERT' then 'null'::jsonb else previous->key end;
    after_value:=case when tg_op='DELETE' then 'null'::jsonb else current_row->key end;
    if before_value is distinct from after_value then
      -- Record that content changed, never duplicate bodies, notes, or storage paths.
      if key in ('description','body','content','logo_path','related_article_ids') then
        before_value:=case when before_value is null or before_value='null'::jsonb then 'null'::jsonb else '"Previous content"'::jsonb end;
        after_value:=case when after_value is null or after_value='null'::jsonb then 'null'::jsonb else '"Content updated"'::jsonb end;
      else
        before_value:=private.audit_display_value(org,key,before_value);
        after_value:=private.audit_display_value(org,key,after_value);
      end if;
      delta:=delta||jsonb_build_array(jsonb_build_object('field',key,'from',before_value,'to',after_value));
    end if;
  end loop;
  if tg_op='UPDATE' and jsonb_array_length(delta)=0 then return new; end if;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_label,tg_table_name,target,coalesce(target_label,tg_table_name),case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
  return case when tg_op='DELETE' then old else new end;
end $function$;

CREATE OR REPLACE FUNCTION public.custom_report (
  target_organization_id uuid,
  report_config          jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
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
      coalesce(d.name,'No department') department_name,coalesce(l.path,'No location') location_name,
      case selected_group when 'status' then t.status::text when 'priority' then t.priority::text
        when 'category' then coalesce(t.category_id::text,'none') when 'subcategory' then coalesce(t.subcategory_id::text,'none')
        when 'team' then coalesce(t.team_id::text,'none') when 'technician' then coalesce(t.assigned_technician_id::text,'none')
        when 'department' then coalesce(requester.department_id::text,'none') when 'location' then coalesce(t.location_id::text,'none') else 'time' end group_key,
      case selected_group when 'status' then initcap(replace(t.status::text,'_',' ')) when 'priority' then case when t.priority='critical' then 'Urgent' else initcap(t.priority::text) end
        when 'category' then coalesce(c.name,'Uncategorized') when 'subcategory' then coalesce(sc.name,'No subcategory')
        when 'team' then coalesce(team.name,'Unassigned team') when 'technician' then coalesce(tech.display_name,'Unassigned')
        when 'department' then coalesce(d.name,'No department') when 'location' then coalesce(l.path,'No location') else 'Time' end group_label
    from public.tickets t
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.ticket_subcategories sc on sc.organization_id=t.organization_id and sc.id=t.subcategory_id
    left join public.teams team on team.organization_id=t.organization_id and team.id=t.team_id
    left join public.profiles tech on tech.organization_id=t.organization_id and tech.user_id=t.assigned_technician_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.location_paths l on l.organization_id=t.organization_id and l.id=t.location_id
    where t.organization_id=target_organization_id and t.created_at<=report_now
      and (cardinality(statuses)=0 or t.status::text=any(statuses)) and (cardinality(priorities)=0 or t.priority::text=any(priorities))
      and (cardinality(category_ids)=0 or t.category_id=any(category_ids)) and (cardinality(subcategory_ids)=0 or t.subcategory_id=any(subcategory_ids))
      and (cardinality(team_ids)=0 or t.team_id=any(team_ids)) and (cardinality(technician_ids)=0 or t.assigned_technician_id=any(technician_ids))
      and (cardinality(department_ids)=0 or requester.department_id=any(department_ids)) and (cardinality(location_ids)=0 or l.path_ids && location_ids)
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
end $function$;

CREATE OR REPLACE FUNCTION public.lookup_choices (
  org         uuid,
  resource    text,
  query       text    DEFAULT ''::text,
  after_label text    DEFAULT NULL::text,
  after_id    uuid    DEFAULT NULL::uuid,
  selected    uuid    DEFAULT NULL::uuid,
  parent      uuid    DEFAULT NULL::uuid,
  active_only boolean DEFAULT true
)
  RETURNS TABLE (
    id        uuid,
    label     text,
    active    boolean,
    parent_id uuid
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
 with choices as (
  select p.user_id id, p.display_name || case when p.email is null then '' else ' · ' || p.email end label,
   m.status='active' active, null::uuid parent_id
  from public.profiles p join public.organization_memberships m using (organization_id,user_id)
  where p.organization_id=org and resource in ('people','technicians')
   and (resource='people' or m.role in ('administrator','technician'))
   and private.has_organization_role(org,array['administrator','technician']::public.app_role[])
  union all select t.id,t.name,t.is_active,null::uuid from public.teams t
   where t.organization_id=org and resource='teams'
   and private.has_organization_role(org,array['administrator','technician']::public.app_role[])
  union all select d.id,d.name,d.is_active,null::uuid from public.departments d where d.organization_id=org and resource='departments'
  union all select l.id,l.path,l.is_active,l.parent_id from public.location_paths l where l.organization_id=org and resource in ('locations','location_parents') and (resource<>'location_parents' or (private.has_organization_role(org,array['administrator']::public.app_role[]) and (parent is null or not parent=any(l.path_ids))))
  union all select c.id,c.name,c.is_active,null::uuid from public.ticket_categories c where c.organization_id=org and resource='categories'
  union all select s.id,s.name,s.is_active,s.category_id from public.ticket_subcategories s where s.organization_id=org and resource='subcategories' and s.category_id=parent
 )
 select c.id,c.label,c.active,c.parent_id from choices c
 where private.is_active_organization_member(org)
 and case when selected is not null then c.id=selected else
  (not active_only or c.active) and c.label ilike all(private.search_patterns(query))
  and (after_id is null or (c.label,c.id)>(after_label,after_id)) end
 order by c.label,c.id limit 51;
$function$;

CREATE OR REPLACE FUNCTION public.operational_report (
  target_organization_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  report_now timestamptz := now();
  today date;
  report_timezone text;
  result jsonb;
begin
  if not exists (select 1 from public.organization_memberships m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('administrator', 'technician')) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  select timezone into strict report_timezone from public.organizations where id = target_organization_id;
  today := (report_now at time zone report_timezone)::date;
  with base as materialized (
    select t.*, (t.created_at at time zone report_timezone)::date as created_day,
      (t.first_response_at at time zone report_timezone)::date as response_day,
      (t.resolved_at at time zone report_timezone)::date as resolved_day,
      t.status not in ('resolved','closed') as active,
      extract(epoch from (t.first_response_at-t.created_at))/60 as response_minutes,
      extract(epoch from (t.resolved_at-t.created_at))/60 as resolution_minutes,
      coalesce(c.name,'Uncategorized') as category_name,
      coalesce(p.display_name,'Unassigned') as technician_name,
      coalesce(d.name,'No department') as department_name,
      coalesce(l.path,'No location') as location_name
    from public.tickets t
    left join public.ticket_categories c on c.organization_id=t.organization_id and c.id=t.category_id
    left join public.profiles p on p.organization_id=t.organization_id and p.user_id=t.assigned_technician_id
    left join public.profiles requester on requester.organization_id=t.organization_id and requester.user_id=t.requester_id
    left join public.departments d on d.organization_id=t.organization_id and d.id=requester.department_id
    left join public.location_paths l on l.organization_id=t.organization_id and l.id=t.location_id
    where t.organization_id=target_organization_id and t.created_at <= report_now
  ), events as materialized (
    select a.ticket_id, (a.created_at at time zone report_timezone)::date as day,
      a.details->>'from' in ('resolved','closed') and a.details->>'to' not in ('resolved','closed') as reopened,
      a.details->>'from' not in ('resolved','closed') and a.details->>'to' in ('resolved','closed') as resolved
    from public.ticket_activity a
    where a.organization_id=target_organization_id and a.action='status_changed'
      and a.created_at >= ((today-29)::timestamp at time zone report_timezone) and a.created_at <= report_now
  ), days as (select today - i as day from generate_series(0,29) i), daily as (
    select day,
      (select count(*) from base where created_day=days.day) as created,
      (select count(distinct ticket_id) from events where events.day=days.day and resolved) as resolved,
      (select count(distinct ticket_id) from events where events.day=days.day and reopened) as reopened,
      (select avg(response_minutes) from base where response_day=days.day and response_minutes>=0) as response,
      (select avg(resolution_minutes) from base where resolved_day=days.day and resolution_minutes>=0) as resolution
    from days
  ), objectives as (
    select 'Response' as label, first_response_at <= response_sla_due_at as met from base
    where response_day>=today-29 and first_response_at<=report_now and response_sla_due_at is not null
    union all
    select 'Resolution', resolved_at <= resolution_sla_due_at from base
    where resolved_day>=today-29 and resolved_at<=report_now and resolution_sla_due_at is not null
  ), breakdowns as (
    select 'categories' as kind, category_name as label, count(*) as value from base where created_day>=today-29 group by category_id,category_name
    union all select 'workload',technician_name,count(*) from base where active group by assigned_technician_id,technician_name
    union all select 'departments',department_name,count(*) from base where created_day>=today-29 group by department_name
    union all select 'locations',location_name,count(*) from base where created_day>=today-29 group by location_id,location_name
    union all select 'backlog',case when report_now-created_at<interval '1 day' then 'Under 1 day' when report_now-created_at<interval '7 days' then '1–6 days' when report_now-created_at<interval '30 days' then '7–29 days' else '30+ days' end,count(*) from base where active group by 2
  )
  select jsonb_build_object(
    'asOf',report_now,'timezone',report_timezone,'today',today,
    'summary',jsonb_build_object(
      'created',(select count(*) from base where created_day=today),
      'resolved',(select count(distinct ticket_id) from events where day=today and resolved),
      'open',(select count(*) from base where active),
      'overdue',(select count(*) from base where active and sla_next_due_at<=report_now),
      'response',(select avg(response_minutes) from base where response_day=today and response_minutes>=0),
      'resolution',(select avg(resolution_minutes) from base where resolved_day=today and resolution_minutes>=0)),
    'daily',(select jsonb_agg(to_jsonb(daily) order by day) from daily),
    'breakdowns',coalesce((select jsonb_agg(to_jsonb(breakdowns) order by kind,value desc,label) from breakdowns),'[]'::jsonb),
    'sla',coalesce((select jsonb_agg(s) from (select label,count(*) as total,count(*) filter(where met) as met from objectives group by label order by label) s),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

ALTER TABLE "public"."locations"
  ADD CONSTRAINT "locations_parent_fkey" FOREIGN KEY (organization_id, parent_id) REFERENCES public.locations(organization_id, id) ON DELETE NO ACTION;

CREATE VIEW "public"."location_paths" WITH (security_invoker=true) AS  WITH RECURSIVE tree AS (
         SELECT l.id,
            l.organization_id,
            l.name,
            l.address_line_1,
            l.address_line_2,
            l.city,
            l.region,
            l.postal_code,
            l.country_code,
            l.timezone,
            l.is_active,
            l.created_at,
            l.updated_at,
            l.parent_id,
            l.name AS path,
            ARRAY[l.id] AS path_ids,
            1 AS depth
           FROM public.locations l
          WHERE (l.parent_id IS NULL)
        UNION ALL
         SELECT l.id,
            l.organization_id,
            l.name,
            l.address_line_1,
            l.address_line_2,
            l.city,
            l.region,
            l.postal_code,
            l.country_code,
            l.timezone,
            l.is_active,
            l.created_at,
            l.updated_at,
            l.parent_id,
            ((t.path || ' / '::text) || l.name),
            (t.path_ids || l.id),
            (t.depth + 1)
           FROM (public.locations l
             JOIN tree t ON (((t.organization_id = l.organization_id) AND (t.id = l.parent_id))))
          WHERE ((t.depth < 8) AND (NOT (l.id = ANY (t.path_ids))))
        )
 SELECT id,
    organization_id,
    name,
    address_line_1,
    address_line_2,
    city,
    region,
    postal_code,
    country_code,
    timezone,
    is_active,
    created_at,
    updated_at,
    parent_id,
    path,
    path_ids,
    depth
   FROM tree;

REVOKE ALL ON TABLE "public"."location_paths" FROM "anon";

CREATE INDEX locations_parent_idx ON public.locations USING btree (organization_id, parent_id);

CREATE UNIQUE INDEX locations_root_name_key ON public.locations USING btree (organization_id, name)
  WHERE (parent_id IS NULL);

CREATE UNIQUE INDEX locations_sibling_name_key ON public.locations USING btree (organization_id, parent_id, name)
  WHERE (parent_id IS NOT NULL);

CREATE TRIGGER locations_hierarchy_guard
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_location_hierarchy();

REVOKE ALL ON FUNCTION "private"."guard_location_hierarchy"() FROM PUBLIC;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."location_paths" TO "authenticated";

REVOKE ALL ON TABLE "public"."location_paths" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."location_paths" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."location_paths" TO "service_role";


-- Keep the computed view read-only even when schema defaults grant table privileges.
REVOKE ALL ON TABLE public.location_paths FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.location_paths TO authenticated, service_role;
