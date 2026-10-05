-- Stage 7 bounded read models only. No activation or execution capability.
create function private.read_automation_admin(org uuid,kind text,query text,state text,trigger_type text,resource text,target uuid,selected uuid[],page_number integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
        union all select id,name,is_active,null::uuid from public.locations where organization_id=org and resource='locations'
        union all select id,'Ticket #'||ticket_number||' · '||title,true,null::uuid from public.tickets where organization_id=org and resource='tickets'
      ) choices where case when cardinality(selected)>0 then id=any(selected) else label ilike all(patterns) end
      order by label,id limit case when cardinality(selected)>0 then 100 else 51 end offset case when cardinality(selected)>0 then 0 else (page_number-1)*50 end
    ) data;
    return jsonb_build_object('rows',rows);
  else raise exception 'Invalid read kind' using errcode='22023'; end if;
end $$;
create function public.read_automation_admin(org uuid,kind text,query text default '',state text default 'all',trigger_type text default '',resource text default '',target uuid default null,selected uuid[] default '{}',page_number integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.read_automation_admin(org,kind,query,state,trigger_type,resource,target,selected,page_number); $$;
revoke all on function private.read_automation_admin(uuid,text,text,text,text,text,uuid,uuid[],integer),public.read_automation_admin(uuid,text,text,text,text,text,uuid,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function private.read_automation_admin(uuid,text,text,text,text,text,uuid,uuid[],integer),public.read_automation_admin(uuid,text,text,text,text,text,uuid,uuid[],integer) to authenticated;
