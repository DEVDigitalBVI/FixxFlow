-- Read-only dry-run boundary. No processing activation, writes, locks or execution.
create function private.automation_reference_read(org uuid, resource text, target uuid, action_target boolean) returns boolean
language sql stable set search_path='' as $$
  select case resource
    when 'active_ticket_workers' then exists(select 1 from public.organization_memberships where organization_id=org and user_id=target and role in ('technician','administrator') and (not action_target or status='active'))
    when 'organization_memberships' then exists(select 1 from public.organization_memberships where organization_id=org and user_id=target)
    when 'teams' then exists(select 1 from public.teams where organization_id=org and id=target and (not action_target or is_active))
    when 'ticket_categories' then exists(select 1 from public.ticket_categories where organization_id=org and id=target and (not action_target or is_active))
    when 'ticket_subcategories' then exists(select 1 from public.ticket_subcategories where organization_id=org and id=target)
    when 'departments' then exists(select 1 from public.departments where organization_id=org and id=target)
    when 'locations' then exists(select 1 from public.locations where organization_id=org and id=target)
    else false end;
$$;
create function private.read_automation_dry_run(target_organization_id uuid,ticket_id uuid,event_id uuid,rule_id uuid,rule_version bigint,draft jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid; ticket public.tickets; event private.domain_events; version public.automation_rule_versions;
  definition jsonb; catalog jsonb:=private.automation_definition_catalog(); item jsonb; spec jsonb; candidate jsonb; property record;
  checks jsonb:='[]'; valid boolean; conditions_valid boolean:=true; assignee uuid; recipient uuid; category uuid; subcategory uuid;
begin
  if auth.uid() is null or not private.has_required_assurance() or not coalesce(private.has_organization_role(target_organization_id,array['administrator']::public.app_role[]),false) then raise exception 'Administrator and assurance required' using errcode='42501'; end if;
  select organization_id into org from public.organization_memberships where organization_id=target_organization_id and user_id=auth.uid() and role='administrator' and status='active';
  if org is null then raise exception 'Access denied' using errcode='42501'; end if;
  select * into ticket from public.tickets t where t.organization_id=org and t.id=ticket_id;
  if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
  if event_id is not null then
    select * into event from private.domain_events e where e.organization_id=org and e.id=event_id and e.entity_type='ticket' and e.entity_id=ticket.id;
    if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
  end if;
  if rule_id is not null then
    if draft is not null or rule_version is null or rule_version<1 then raise exception 'Invalid definition source' using errcode='22023'; end if;
    select * into version from public.automation_rule_versions v where v.organization_id=org and v.rule_id=read_automation_dry_run.rule_id and v.version=rule_version;
    if not found then raise exception 'Test source unavailable' using errcode='P0002'; end if;
    definition:=private.validate_automation_definition(version.definition);
  else
    if rule_version is not null or draft is null then raise exception 'Invalid definition source' using errcode='22023'; end if;
    definition:=private.validate_automation_definition(draft);
  end if;
  -- Validate reference existence separately from structural validity, without
  -- taking the mutation adapter's FOR SHARE locks or exposing foreign names.
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    spec:=catalog#>array['fields','ticket:'||(item->>'field'),'value'];
    if spec->>'kind'='reference' and item?'value' then
      for candidate in select * from jsonb_array_elements(case when jsonb_typeof(item->'value')='array' then item->'value' else jsonb_build_array(item->'value') end) loop
        conditions_valid:=private.automation_reference_read(org,spec->>'resource',(candidate#>>'{}')::uuid,false) and conditions_valid;
      end loop;
    end if;
    if item->>'operator'='equals' and item->>'field'='category_id' then category:=(item->>'value')::uuid; end if;
    if item->>'operator'='equals' and item->>'field'='subcategory_id' then subcategory:=(item->>'value')::uuid; end if;
  end loop;
  if category is not null and subcategory is not null then
    conditions_valid:=conditions_valid and exists(select 1 from public.ticket_subcategories s where s.organization_id=org and s.id=subcategory and s.category_id=category);
  end if;
  assignee:=ticket.assigned_technician_id;
  for item in select * from jsonb_array_elements(definition->'actions') loop
    valid:=true;
    for property in select * from jsonb_each(catalog#>array['actions',item->>'type','configuration']) loop
      spec:=property.value->'value';
      if spec->>'kind'='reference' then valid:=private.automation_reference_read(org,spec->>'resource',(item#>>array['configuration',property.key])::uuid,true) and valid; end if;
    end loop;
    -- Resolve an explicit notification's recipient after preceding proposed
    -- assignments, without applying those assignments to any record.
    if item->>'type'='assign_technician' then assignee:=(item#>>'{configuration,technicianId}')::uuid; end if;
    if item->>'type'='send_notification' then
      recipient:=case item#>>'{configuration,recipient}' when 'requester' then ticket.requester_id else assignee end;
      valid:=exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=recipient and m.status='active' and
        (m.role in ('technician','administrator') or (item#>>'{configuration,recipient}'='requester' and m.user_id=ticket.requester_id)));
    end if;
    checks:=checks||jsonb_build_array(jsonb_build_object('actionId',item->>'id','valid',valid));
  end loop;
  return jsonb_build_object('organizationId',org,'ticketId',ticket.id,'ticketNumber',ticket.ticket_number,'revision',ticket.revision,
    'snapshot',private.ticket_event_snapshot(ticket),'event',case when event.id is null then null else private.domain_event_envelope(event) end,
    'definition',definition,'ruleId',rule_id,'ruleVersion',rule_version,'storedEnabled',version.enabled,'storedArchived',version.archived_at is not null,
    'conditionsReferencesValid',conditions_valid,'actionReferences',checks);
end $$;
create function public.read_automation_dry_run(target_organization_id uuid,ticket_id uuid,event_id uuid default null,rule_id uuid default null,rule_version bigint default null,draft jsonb default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.read_automation_dry_run(target_organization_id,ticket_id,event_id,rule_id,rule_version,draft); $$;
revoke all on function private.automation_reference_read(uuid,text,uuid,boolean),private.read_automation_dry_run(uuid,uuid,uuid,uuid,bigint,jsonb),public.read_automation_dry_run(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.read_automation_dry_run(uuid,uuid,uuid,uuid,bigint,jsonb),public.read_automation_dry_run(uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;
