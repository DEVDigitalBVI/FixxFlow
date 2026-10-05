-- Stage 2 only. No events, execution, notifications, or ticket writes.
-- The catalog is application-owned structured data, never an executable rule.
create function private.automation_definition_catalog() returns jsonb
language sql immutable set search_path='' as $$ select '{"triggers":{"ticket.created":{"entityType":"ticket","configuration":{}},"ticket.updated":{"entityType":"ticket","configuration":{}},"ticket.assigned":{"entityType":"ticket","configuration":{}},"ticket.status_changed":{"entityType":"ticket","configuration":{}},"ticket.priority_changed":{"entityType":"ticket","configuration":{}},"ticket.resolved":{"entityType":"ticket","configuration":{}}},"fields":{"ticket:priority":{"value":{"kind":"enum","values":["low","normal","high","critical"],"ordered":true},"operators":["equals","not_equals","in","not_in","greater_than","less_than"]},"ticket:status":{"value":{"kind":"enum","values":["new","open","in_progress","waiting_on_user","on_hold","resolved","closed"]},"operators":["equals","not_equals","in","not_in"]},"ticket:title":{"value":{"kind":"string","minLength":3,"maxLength":180},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty","contains","not_contains"]},"ticket:category_id":{"value":{"kind":"reference","resource":"ticket_categories"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:subcategory_id":{"value":{"kind":"reference","resource":"ticket_subcategories"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:assigned_technician_id":{"value":{"kind":"reference","resource":"active_ticket_workers"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:team_id":{"value":{"kind":"reference","resource":"teams"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:requester_id":{"value":{"kind":"reference","resource":"organization_memberships"},"operators":["equals","not_equals","in","not_in"]},"ticket:requester_department_id":{"value":{"kind":"reference","resource":"departments"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]},"ticket:location_id":{"value":{"kind":"reference","resource":"locations"},"operators":["equals","not_equals","in","not_in","is_empty","is_not_empty"]}},"actions":{"assign_technician":{"entityType":"ticket","configuration":{"technicianId":{"value":{"kind":"reference","resource":"active_ticket_workers"}}}},"assign_team":{"entityType":"ticket","configuration":{"teamId":{"value":{"kind":"reference","resource":"teams"}}}},"set_priority":{"entityType":"ticket","configuration":{"priority":{"value":{"kind":"enum","values":["low","normal","high","critical"],"ordered":true}}}},"set_status":{"entityType":"ticket","configuration":{"status":{"value":{"kind":"enum","values":["new","open","in_progress","waiting_on_user","on_hold","resolved","closed"]}}}},"set_category":{"entityType":"ticket","configuration":{"categoryId":{"value":{"kind":"reference","resource":"ticket_categories"}}}},"add_internal_note":{"entityType":"ticket","configuration":{"body":{"value":{"kind":"string","minLength":1,"maxLength":20000}}}},"send_notification":{"entityType":"ticket","configuration":{"recipient":{"value":{"kind":"enum","values":["requester","assigned_technician"]}},"template":{"value":{"kind":"enum","values":["ticket_update"]}}}}}}'::jsonb $$;

-- JavaScript string limits use UTF-16 code units, including astral characters.
create function private.automation_text_length(value text) returns integer
language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when c='' then 0 when ascii(c)>65535 then 2 else 1 end),0)::integer
  from regexp_split_to_table(value,'') c;
$$;
create function private.automation_trim(value text) returns text
language sql immutable strict set search_path='' as $$
  select btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create function private.automation_object(value jsonb, keys text[]) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(value)='object' then (value-keys)='{}'::jsonb else false end;
$$;
create function private.automation_identifier(value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(value)='string' and (value#>>'{}') ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$',false);
$$;
create function private.automation_bounded_json(value jsonb) returns boolean
language sql immutable set search_path='' as $$
  with recursive nodes(value,key,depth) as (
    select $1,''::text,0
    union all
    select child.value,child.key,n.depth+1 from nodes n cross join lateral (
      select e.value,e.key from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end) e
      union all
      select a.value,(a.ordinality-1)::text from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end) with ordinality a
    ) child where n.depth<=12
  ) select $1 is not null and count(*)<=10000 and max(depth)<=12
    and coalesce(sum(private.automation_text_length(key)+case when jsonb_typeof(nodes.value)='string' then private.automation_text_length(nodes.value#>>'{}') else 0 end),0)<=100000
    and bool_and(key not in ('__proto__','prototype','constructor'))
    and bool_and(case when jsonb_typeof(nodes.value)='array' then jsonb_array_length(nodes.value)<=1000 else true end)
  from nodes;
$$;

create function private.automation_value_valid(value jsonb, spec jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare text_value text:=value#>>'{}'; number_value numeric;
begin
  if value is null or value='null'::jsonb then return false; end if;
  case spec->>'kind'
    when 'reference' then return jsonb_typeof(value)='string' and text_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    when 'enum' then return jsonb_typeof(value)='string' and (spec->'values') @> jsonb_build_array(value);
    when 'string' then return jsonb_typeof(value)='string' and private.automation_text_length(private.automation_trim(text_value))>=coalesce((spec->>'minLength')::integer,0) and private.automation_text_length(text_value)<=(spec->>'maxLength')::integer;
    when 'boolean' then return jsonb_typeof(value)='boolean';
    when 'string_set' then
      if jsonb_typeof(value)<>'array' then return false; end if;
      return jsonb_array_length(value)<=(spec->>'maxItems')::integer
        and not exists(select 1 from jsonb_array_elements(value) e where jsonb_typeof(e)<>'string' or private.automation_text_length(e#>>'{}') not between 1 and (spec->>'itemMaxLength')::integer)
        and (select count(*)=count(distinct e) from jsonb_array_elements(value) e);
    when 'number' then
      if jsonb_typeof(value)<>'number' then return false; end if;
      number_value:=text_value::numeric;
      return abs(number_value)<=1.7976931348623157e308::numeric
        and (not coalesce((spec->>'integer')::boolean,false) or (trunc(number_value)=number_value and abs(number_value)<=9007199254740991))
        and (not (spec?'min') or number_value>=(spec->>'min')::numeric)
        and (not (spec?'max') or number_value<=(spec->>'max')::numeric);
    else return false;
  end case;
end $$;
create function private.automation_configuration_valid(value jsonb, spec jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare property record;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(value) key where not (spec?key)) then return false; end if;
  for property in select * from jsonb_each(spec) loop
    if not (value?property.key) then
      if not coalesce((property.value->>'optional')::boolean,false) then return false; end if;
    elsif not coalesce(private.automation_value_valid(value->property.key,property.value->'value'),false) then return false;
    end if;
  end loop;
  return true;
end $$;

create function private.validate_automation_definition(definition jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare catalog jsonb:=private.automation_definition_catalog(); trigger_spec jsonb; field_spec jsonb; action_spec jsonb;
  item jsonb; candidate jsonb; op text; ids text[]; positions integer[]:='{}'; position integer; canonical_actions jsonb;
begin
  if not private.automation_bounded_json(definition) or not private.automation_object(definition,array['schemaVersion','name','description','trigger','conditions','actions']) then raise exception 'Invalid automation definition' using errcode='22023'; end if;
  if definition->'schemaVersion' is distinct from '1'::jsonb
    or not private.automation_value_valid(definition->'name','{"kind":"string","minLength":1,"maxLength":120}')
    or not (definition?'description') or (definition->'description'<>'null'::jsonb and not private.automation_value_valid(definition->'description','{"kind":"string","maxLength":2000}')) then raise exception 'Invalid automation metadata' using errcode='22023'; end if;
  trigger_spec:=catalog->'triggers'->(definition#>>'{trigger,type}');
  if trigger_spec is null or not private.automation_object(definition->'trigger',array['type','configuration'])
    or not private.automation_configuration_valid(definition#>'{trigger,configuration}',trigger_spec->'configuration') then raise exception 'Invalid automation trigger' using errcode='22023'; end if;
  item:=definition->'conditions';
  if not private.automation_object(item,array['kind','id','operator','children']) or item->>'kind' is distinct from 'group' or item->>'operator' is distinct from 'and'
    or not private.automation_identifier(item->'id') or jsonb_typeof(item->'children') is distinct from 'array' then raise exception 'Invalid AND group' using errcode='22023'; end if;
  if jsonb_array_length(item->'children')>50 then raise exception 'Too many conditions' using errcode='22023'; end if;
  ids:=array[item->>'id'];
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    if not private.automation_object(item,array['kind','id','field','operator','value']) or item->>'kind' is distinct from 'condition'
      or not private.automation_identifier(item->'id') or (item->>'id')=any(ids) then raise exception 'Invalid condition' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
    field_spec:=catalog->'fields'->((trigger_spec->>'entityType')||':'||(item->>'field'));
    op:=item->>'operator';
    if field_spec is null or not coalesce((field_spec->'operators') @> jsonb_build_array(op),false) then raise exception 'Invalid condition field or operator' using errcode='22023'; end if;
    if op in ('is_empty','is_not_empty') then
      if item?'value' then raise exception 'Unexpected condition value' using errcode='22023'; end if;
    elsif op in ('in','not_in') then
      if jsonb_typeof(item->'value') is distinct from 'array' then raise exception 'Invalid condition list' using errcode='22023'; end if;
      if jsonb_array_length(item->'value') not between 1 and 100 then raise exception 'Invalid condition list' using errcode='22023'; end if;
      for candidate in select * from jsonb_array_elements(item->'value') loop
        if not coalesce(private.automation_value_valid(candidate,field_spec->'value'),false) then raise exception 'Invalid condition value' using errcode='22023'; end if;
      end loop;
    else
      if op in ('contains','not_contains') then
        if field_spec#>>'{value,kind}'='string_set' then
          field_spec:=jsonb_set(field_spec,'{value}',jsonb_build_object('kind','string','minLength',1,'maxLength',field_spec#>'{value,itemMaxLength}'));
        else field_spec:=jsonb_set(field_spec,'{value,minLength}','1'); end if;
      end if;
      if not coalesce(private.automation_value_valid(item->'value',field_spec->'value'),false) then raise exception 'Invalid condition value' using errcode='22023'; end if;
    end if;
  end loop;
  if jsonb_typeof(definition->'actions') is distinct from 'array' then raise exception 'Invalid actions' using errcode='22023'; end if;
  if jsonb_array_length(definition->'actions') not between 1 and 20 then raise exception 'Invalid action count' using errcode='22023'; end if;
  ids:='{}';
  for item in select * from jsonb_array_elements(definition->'actions') loop
    if not private.automation_object(item,array['id','type','position','configuration']) or not private.automation_identifier(item->'id') or (item->>'id')=any(ids)
      or not coalesce(private.automation_value_valid(item->'position',jsonb_build_object('kind','number','integer',true,'min',0,'max',jsonb_array_length(definition->'actions')-1)),false) then raise exception 'Invalid action order or identifier' using errcode='22023'; end if;
    position:=(item->>'position')::numeric::integer;
    if position=any(positions) then raise exception 'Duplicate action position' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id'); positions:=array_append(positions,position);
    action_spec:=catalog->'actions'->(item->>'type');
    if action_spec is null or action_spec->>'entityType' is distinct from trigger_spec->>'entityType'
      or (action_spec?'triggerTypes' and not (action_spec->'triggerTypes') @> jsonb_build_array(definition#>>'{trigger,type}'))
      or not private.automation_configuration_valid(item->'configuration',action_spec->'configuration') then raise exception 'Invalid automation action' using errcode='22023'; end if;
  end loop;
  select jsonb_agg(value order by (value->>'position')::numeric) into canonical_actions from jsonb_array_elements(definition->'actions');
  return jsonb_set(definition,'{actions}',canonical_actions);
end $$;

-- Domain-specific reference adapter. No dynamic SQL or table names from rules.
-- Conditions may retain inactive historical values; action targets must be active.
create function private.automation_ticket_reference(org uuid, resource text, target uuid, action_target boolean) returns boolean
language plpgsql set search_path='' as $$
begin
  case resource
    when 'active_ticket_workers' then perform 1 from public.organization_memberships where organization_id=org and user_id=target and role in ('technician','administrator') and (not action_target or status='active') for share;
    when 'organization_memberships' then perform 1 from public.organization_memberships where organization_id=org and user_id=target for share;
    when 'teams' then perform 1 from public.teams where organization_id=org and id=target and (not action_target or is_active) for share;
    when 'ticket_categories' then perform 1 from public.ticket_categories where organization_id=org and id=target and (not action_target or is_active) for share;
    when 'ticket_subcategories' then perform 1 from public.ticket_subcategories where organization_id=org and id=target for share;
    when 'departments' then perform 1 from public.departments where organization_id=org and id=target for share;
    when 'locations' then perform 1 from public.locations where organization_id=org and id=target for share;
    else return false;
  end case;
  return found;
end $$;
-- Trusted domain dispatch, extended by migrations when a new adapter is added.
create function private.automation_reference_exists(org uuid, domain text, resource text, target uuid, action_target boolean) returns boolean
language plpgsql set search_path='' as $$
begin
  case domain
    when 'ticket' then return private.automation_ticket_reference(org,resource,target,action_target);
    else return false;
  end case;
end $$;
create function private.validate_automation_references(org uuid, definition jsonb) returns void
language plpgsql set search_path='' as $$
declare catalog jsonb:=private.automation_definition_catalog(); domain text:=catalog#>>array['triggers',definition#>>'{trigger,type}','entityType']; item jsonb; spec jsonb; candidate jsonb; property record;
begin
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    spec:=catalog#>array['fields',domain||':'||(item->>'field'),'value'];
    if spec->>'kind'='reference' and item?'value' then
      for candidate in select * from jsonb_array_elements(case when jsonb_typeof(item->'value')='array' then item->'value' else jsonb_build_array(item->'value') end) loop
        if not private.automation_reference_exists(org,domain,spec->>'resource',(candidate#>>'{}')::uuid,false) then raise exception 'Unavailable automation reference' using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
  for item in select * from jsonb_array_elements(definition->'actions') loop
    for property in select * from jsonb_each(catalog#>array['actions',item->>'type','configuration']) loop
      spec:=property.value->'value';
      if spec->>'kind'='reference' and (item->'configuration')?property.key then
        if not private.automation_reference_exists(org,domain,spec->>'resource',(item#>>array['configuration',property.key])::uuid,true) then raise exception 'Unavailable automation reference' using errcode='22023'; end if;
      end if;
    end loop;
  end loop;
end $$;

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  definition jsonb not null,
  name text generated always as (definition->>'name') stored,
  description text generated always as (definition->>'description') stored,
  trigger_type text generated always as (definition#>>'{trigger,type}') stored,
  trigger_configuration jsonb generated always as (definition#>'{trigger,configuration}') stored,
  conditions jsonb generated always as (definition->'conditions') stored,
  actions jsonb generated always as (definition->'actions') stored,
  enabled boolean not null default false,
  version bigint not null default 1 check(version between 1 and 9007199254740991),
  created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  enabled_at timestamptz, archived_at timestamptz,
  unique(organization_id,id),
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id),
  foreign key(organization_id,updated_by) references public.organization_memberships(organization_id,user_id),
  check((enabled and enabled_at is not null and archived_at is null) or (not enabled and enabled_at is null)),
  check(definition=private.validate_automation_definition(definition))
);
create table public.automation_rule_versions (
  organization_id uuid not null, rule_id uuid not null,
  version bigint not null check(version between 1 and 9007199254740991),
  definition jsonb not null,
  enabled boolean not null, enabled_at timestamptz, archived_at timestamptz,
  created_by uuid not null, created_at timestamptz not null default now(),
  primary key(organization_id,rule_id,version),
  foreign key(organization_id,rule_id) references public.automation_rules(organization_id,id),
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id)
);
create index automation_rules_list on public.automation_rules(organization_id,updated_at desc,id);
create index automation_rules_active_trigger on public.automation_rules(organization_id,trigger_type) where enabled and archived_at is null;
create index automation_rules_creator on public.automation_rules(organization_id,created_by);
create index automation_rules_updater on public.automation_rules(organization_id,updated_by);
create index automation_versions_creator on public.automation_rule_versions(organization_id,created_by);
alter table public.automation_rules enable row level security;
alter table public.automation_rule_versions enable row level security;
revoke all on public.automation_rules,public.automation_rule_versions from public,anon,authenticated,service_role;
grant select on public.automation_rules,public.automation_rule_versions to authenticated;
create policy automation_rules_admin_read on public.automation_rules for select to authenticated using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy automation_versions_admin_read on public.automation_rule_versions for select to authenticated using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy automation_rules_mfa on public.automation_rules as restrictive for select to authenticated using((select private.has_required_assurance()));
create policy automation_versions_mfa on public.automation_rule_versions as restrictive for select to authenticated using((select private.has_required_assurance()));

create trigger automation_versions_immutable before update or delete on public.automation_rule_versions for each row execute function private.protect_audit_event();
create trigger automation_rules_no_hard_delete before delete on public.automation_rules for each row execute function private.protect_audit_event();

-- Authenticated wrappers delegate to one private, explicitly authorized operation.
-- Organization input selects a membership; it never confers authorization.
create function private.manage_automation_rule(target_organization_id uuid, target_rule_id uuid, operation text, expected_version bigint, new_definition jsonb, duplicate_name text)
returns public.automation_rules language plpgsql security definer set search_path='' as $$
declare org uuid; actor uuid:=auth.uid(); current_rule public.automation_rules%rowtype; result public.automation_rules%rowtype; validated jsonb; stamp timestamptz:=clock_timestamp();
begin
  if actor is null or not private.has_required_assurance() or not coalesce(private.has_organization_role(target_organization_id,array['administrator']::public.app_role[]),false) then raise exception 'Active administrator and required assurance needed' using errcode='42501'; end if;
  select organization_id into org from public.organization_memberships where organization_id=target_organization_id and user_id=actor and role='administrator' and status='active' for share;
  if org is null then raise exception 'Access denied' using errcode='42501'; end if;
  if operation is null or operation not in ('create','update','duplicate','enable','disable','archive') then raise exception 'Invalid operation' using errcode='22023'; end if;
  if operation<>'create' then
    select * into current_rule from public.automation_rules where organization_id=org and id=target_rule_id for update;
    if not found then raise exception 'Automation unavailable' using errcode='P0002'; end if;
    if expected_version is null or expected_version<1 then raise exception 'Expected version required' using errcode='22023'; end if;
    if current_rule.version<>expected_version then raise exception 'Automation changed; reload before saving' using errcode='40001'; end if;
    if current_rule.archived_at is not null then raise exception 'Automation is archived' using errcode='55000'; end if;
  end if;
  if operation='duplicate' then new_definition:=jsonb_set(current_rule.definition,'{name}',coalesce(to_jsonb(duplicate_name),'null'::jsonb)); end if;
  if operation in ('create','update','duplicate','enable') then
    validated:=private.validate_automation_definition(case when operation='enable' then current_rule.definition else new_definition end);
    perform private.validate_automation_references(org,validated);
  end if;
  if operation in ('create','duplicate') then
    insert into public.automation_rules(organization_id,definition,created_by,updated_by,created_at,updated_at)
    values(org,validated,actor,actor,stamp,stamp) returning * into result;
  else
    if (operation='update' and validated=current_rule.definition) or (operation='enable' and current_rule.enabled) or (operation='disable' and not current_rule.enabled) then return current_rule; end if;
    update public.automation_rules set
      definition=case when operation='update' then validated else definition end,
      enabled=case when operation='enable' then true when operation in ('disable','archive') then false else enabled end,
      enabled_at=case when operation='enable' then stamp when operation in ('disable','archive') then null else enabled_at end,
      archived_at=case when operation='archive' then stamp else null end,
      version=version+1,updated_by=actor,updated_at=stamp
    where organization_id=org and id=target_rule_id returning * into result;
  end if;
  insert into public.automation_rule_versions(organization_id,rule_id,version,definition,enabled,enabled_at,archived_at,created_by,created_at)
  values(org,result.id,result.version,result.definition,result.enabled,result.enabled_at,result.archived_at,actor,stamp);
  return result;
end $$;

create function public.create_automation_rule(target_organization_id uuid, definition jsonb) returns public.automation_rules
language sql security invoker set search_path='' as $$ select private.manage_automation_rule(target_organization_id,null,'create',null,definition,null); $$;
create function public.update_automation_rule(target_organization_id uuid, rule_id uuid, expected_version bigint, definition jsonb) returns public.automation_rules
language sql security invoker set search_path='' as $$ select private.manage_automation_rule(target_organization_id,rule_id,'update',expected_version,definition,null); $$;
create function public.duplicate_automation_rule(target_organization_id uuid, rule_id uuid, expected_version bigint, name text) returns public.automation_rules
language sql security invoker set search_path='' as $$ select private.manage_automation_rule(target_organization_id,rule_id,'duplicate',expected_version,null,name); $$;
create function public.set_automation_rule_enabled(target_organization_id uuid, rule_id uuid, expected_version bigint, enabled boolean) returns public.automation_rules
language sql security invoker set search_path='' as $$ select private.manage_automation_rule(target_organization_id,rule_id,case when enabled then 'enable' when not enabled then 'disable' else null end,expected_version,null,null); $$;
create function public.archive_automation_rule(target_organization_id uuid, rule_id uuid, expected_version bigint) returns public.automation_rules
language sql security invoker set search_path='' as $$ select private.manage_automation_rule(target_organization_id,rule_id,'archive',expected_version,null,null); $$;

-- Default function grants are deliberately removed, including service_role.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and (p.proname like 'automation_%' or p.proname in ('validate_automation_definition','validate_automation_references','manage_automation_rule')))
      or (n.nspname='public' and p.proname in ('create_automation_rule','update_automation_rule','duplicate_automation_rule','set_automation_rule_enabled','archive_automation_rule')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function private.manage_automation_rule(uuid,uuid,text,bigint,jsonb,text),
  public.create_automation_rule(uuid,jsonb),public.update_automation_rule(uuid,uuid,bigint,jsonb),
  public.duplicate_automation_rule(uuid,uuid,bigint,text),public.set_automation_rule_enabled(uuid,uuid,bigint,boolean),public.archive_automation_rule(uuid,uuid,bigint) to authenticated;
