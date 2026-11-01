-- Workspace deletion revokes access and hides directory entries while preserving
-- membership/profile IDs referenced by tickets, chats, equipment and audit history.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.organization_memberships ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.organization_memberships ADD CONSTRAINT deleted_memberships_stay_inactive
  CHECK (deleted_at IS NULL OR status = 'inactive');

CREATE FUNCTION private.delete_workspace_people(org uuid, targets uuid[], confirmed boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role public.app_role;
  selected_ids uuid[];
  target_record public.organization_memberships%rowtype;
  removed integer := 0;
  actor_label text;
  target_label text;
BEGIN
  IF actor IS NULL OR NOT private.has_required_assurance() THEN
    RAISE EXCEPTION 'Staff access and assurance required' USING errcode = '42501';
  END IF;
  IF confirmed IS DISTINCT FROM true OR targets IS NULL OR cardinality(targets) NOT BETWEEN 1 AND 25
    OR array_position(targets, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Confirm a selection of 1 to 25 people' USING errcode = '22023';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO selected_ids FROM unnest(targets) id;
  IF actor = ANY(selected_ids) THEN
    RAISE EXCEPTION 'You cannot delete yourself' USING errcode = '42501';
  END IF;

  -- Lock actor and targets in one consistent order, including inactive targets.
  -- Concurrent role/access edits must finish before authorization is evaluated.
  PERFORM 1 FROM public.organization_memberships m
    WHERE m.organization_id = org AND (m.user_id = actor OR m.user_id = ANY(selected_ids))
    ORDER BY m.user_id FOR UPDATE;
  SELECT m.role INTO actor_role FROM public.organization_memberships m
    WHERE m.organization_id = org AND m.user_id = actor AND m.status = 'active' AND m.deleted_at IS NULL;
  IF actor_role IS NULL OR actor_role NOT IN ('administrator', 'technician') THEN
    RAISE EXCEPTION 'Active IT staff required' USING errcode = '42501';
  END IF;
  IF (SELECT count(*) FROM public.organization_memberships m
      WHERE m.organization_id = org AND m.user_id = ANY(selected_ids)) <> cardinality(selected_ids) THEN
    RAISE EXCEPTION 'Selection unavailable in this workspace' USING errcode = 'P0002';
  END IF;
  IF actor_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = org
      AND m.user_id = ANY(selected_ids) AND m.role <> 'end_user'
  ) THEN
    RAISE EXCEPTION 'Technicians can delete employees only' USING errcode = '42501';
  END IF;

  SELECT display_name INTO actor_label FROM public.profiles WHERE organization_id = org AND user_id = actor;
  FOR target_record IN SELECT * FROM public.organization_memberships m
    WHERE m.organization_id = org AND m.user_id = ANY(selected_ids) AND m.deleted_at IS NULL
    ORDER BY m.user_id
  LOOP
    UPDATE public.organization_memberships SET status = 'inactive',
      deactivated_at = coalesce(deactivated_at, clock_timestamp()), deleted_at = clock_timestamp()
      WHERE organization_id = org AND user_id = target_record.user_id;
    SELECT display_name INTO target_label FROM public.profiles
      WHERE organization_id = org AND user_id = target_record.user_id;
    INSERT INTO public.audit_events(organization_id, actor_id, actor_name, entity_type, entity_id, entity_label, action, changes)
      VALUES(org, actor, coalesce(actor_label, 'IT staff'), 'organization_memberships', target_record.user_id,
        coalesce(target_label, 'Member'), 'deleted',
        jsonb_build_array(jsonb_build_object('field', 'workspace_access', 'from', target_record.status, 'to', 'deleted')));
    removed := removed + 1;
  END LOOP;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION private.delete_workspace_people(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.delete_workspace_people(uuid, uuid[], boolean) TO authenticated;

CREATE FUNCTION public.delete_workspace_people(org uuid, targets uuid[], confirmed boolean)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.delete_workspace_people(org, targets, confirmed);
$$;
REVOKE ALL ON FUNCTION public.delete_workspace_people(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace_people(uuid, uuid[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_members(target_organization_id uuid, search_text text)
RETURNS SETOF public.organization_memberships LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH patterns AS (SELECT private.search_patterns(search_text) AS terms)
  SELECT m.* FROM public.organization_memberships m
    JOIN public.profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
    CROSS JOIN patterns s
  WHERE m.organization_id = target_organization_id AND m.deleted_at IS NULL
    AND (p.display_name || ' ' || coalesce(p.email, '') || ' ' || coalesce(p.job_title, '')) ILIKE s.terms[1]
    AND (p.display_name || ' ' || coalesce(p.email, '') || ' ' || coalesce(p.job_title, '')) ILIKE ALL(s.terms);
$$;

-- Preserve selected historical identities, but omit deleted people from new choices.
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
   and (m.deleted_at is null or p.user_id=selected)
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

-- Both literal and approximate workspace search omit deleted directory entries.
create or replace function public.search_workspace(org uuid,search_text text)
returns table(id uuid,kind text,label text,detail text,audience text,shared boolean,approximate boolean,score double precision)
language sql stable security invoker set search_path='' set pg_trgm.word_similarity_threshold='0.1' as $$
 with input as materialized (
  select trim(left(coalesce(search_text,''),200)) q,
   case when trim(search_text) ~ '^#[0-9]{1,15}$' then substring(trim(search_text) from 2)::bigint end exact_number,
   private.is_active_organization_member(org) and private.has_required_assurance() allowed
 ), terms as materialized (
  select word from input i cross join lateral regexp_split_to_table(i.q,'[[:space:]]+') word
  where i.allowed and i.q<>'' and i.exact_number is null
 ), literal_tickets as materialized (
  select t.* from input i cross join lateral public.search_tickets(org,i.q) t where i.allowed and i.q<>''
 ), literal_people as materialized (
  select p.* from input i cross join lateral public.search_members(org,i.q) m
   join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.user_id
  where i.allowed and i.q<>'' and i.exact_number is null and private.can_work_tickets(org)
 ), literal_articles as materialized (
  select a.* from input i cross join lateral public.search_knowledge_articles(org,i.q) a
  where i.allowed and i.q<>'' and i.exact_number is null and a.status='published'
 ), candidates as (
  select t.id,'ticket'::text kind,t.title label,'#'||t.ticket_number detail,null::text audience,false shared,
    greatest(300,private.workspace_text_score(t.title,t.description,i.q),
      case when t.ticket_number=i.exact_number then 10000 when t.ticket_number::text=i.q then 9500 else 0 end)::double precision score
  from literal_tickets t cross join input i
  union all
  select t.id,'ticket',t.title,'#'||t.ticket_number,null::text,false,
    private.workspace_text_score(t.title,t.description,i.q)
  from public.tickets t cross join input i
  where i.allowed and i.exact_number is null and t.organization_id=org
    and exists(select 1 from terms w where (t.title||' '||t.description) operator(extensions.%>) w.word)
  union all
  select p.user_id,'person',coalesce(nullif(p.display_name,''),p.email,'Member'),coalesce(p.email,''),null::text,false,
    greatest(300,private.workspace_text_score(p.display_name,coalesce(p.email,'')||' '||coalesce(p.job_title,''),i.q))
  from literal_people p cross join input i
  union all
  select p.user_id,'person',coalesce(nullif(p.display_name,''),p.email,'Member'),coalesce(p.email,''),null::text,false,
    private.workspace_text_score(p.display_name,coalesce(p.email,'')||' '||coalesce(p.job_title,''),i.q)
  from public.profiles p cross join input i
  where i.allowed and i.exact_number is null and p.organization_id=org and private.can_work_tickets(org)
    and exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=p.user_id and m.deleted_at is null)
    and exists(select 1 from terms w where (p.display_name||' '||coalesce(p.email,'')||' '||coalesce(p.job_title,'')) operator(extensions.%>) w.word)
  union all
  select a.id,'article',a.title,''::text,a.audience,a.organization_id is null,
    greatest(300,private.workspace_text_score(a.title,a.summary,i.q))
  from literal_articles a cross join input i
  union all
  select a.id,'article',a.title,''::text,a.audience,a.organization_id is null,
    private.workspace_text_score(a.title,a.summary,i.q)
  from public.readable_knowledge_articles a cross join input i
  where i.allowed and i.exact_number is null and (a.organization_id=org or a.organization_id is null) and a.status='published'
    and exists(select 1 from terms w where (a.title||' '||a.summary) operator(extensions.%>) w.word)
 ), ranked as (
  select distinct on(c.kind,c.id) c.* from candidates c where c.score>0 order by c.kind,c.id,c.score desc
 )
 select r.id,r.kind,r.label,r.detail,r.audience,r.shared,r.score<300,r.score
 from ranked r order by r.score desc,lower(r.label),r.kind,r.id limit 20;
$$;

create or replace function private.prepare_member_invitation(org uuid, token uuid, email text, display_name text, member_role public.app_role, actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.member_invitations%rowtype; invited auth.users%rowtype;
begin
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=actor and role='administrator' and status='active') then raise exception 'Active administrator required' using errcode='42501'; end if;
 if token is null or email is null or email<>lower(trim(email)) or length(email)>254 or position('@' in email)<2 or display_name is null or length(display_name) not between 1 and 120 or member_role is null then raise exception 'Invalid invitation'; end if;
 if exists(select 1 from private.member_invitations i where i.id=token and (i.organization_id<>org or i.email<>prepare_member_invitation.email)) then raise exception 'Invitation key already used' using errcode='PT409'; end if;
 insert into private.member_invitations(id,organization_id,email,display_name,role,invited_by)
 values(token,org,email,display_name,member_role,actor) on conflict do nothing;
 select * into invitation from private.member_invitations i where i.email=prepare_member_invitation.email for update;
 if not found then raise exception 'Invitation key already used' using errcode='PT409'; end if;
 if invitation.organization_id<>org then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.organization_memberships m where m.organization_id=org and m.user_id=invitation.user_id and m.deleted_at is not null) then raise exception 'This person was deleted from this workspace' using errcode='PT410'; end if;
 if invitation.completed_at is not null then return jsonb_build_object('id',invitation.id,'userId',invitation.user_id,'completed',true); end if;
 if invitation.display_name<>display_name or invitation.role<>member_role then raise exception 'Retry the original invitation details' using errcode='PT409'; end if;
 select * into invited from auth.users u where lower(u.email)=prepare_member_invitation.email;
 if found then
  -- Existing workspace accounts must be managed through People, never reassigned.
  if invited.invited_at is null or exists(select 1 from public.organization_memberships where user_id=invited.id) then raise exception 'Account already exists' using errcode='PT409'; end if;
  update private.member_invitations set user_id=invited.id where id=invitation.id;
  return jsonb_build_object('id',invitation.id,'userId',invited.id,'completed',false);
 end if;
 if invitation.sending_at>clock_timestamp()-interval '2 minutes' then raise exception 'Invitation is being sent; retry in two minutes' using errcode='PT429'; end if;
 update private.member_invitations set sending_at=clock_timestamp() where id=invitation.id;
 return jsonb_build_object('id',invitation.id,'userId',null,'completed',false);
end $$;

-- Automation pickers retain saved identities without offering deleted people anew.
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
        where m.organization_id=org and (m.deleted_at is null or m.user_id=any(selected)) and (resource='organization_memberships' or (resource='active_ticket_workers' and m.role in ('technician','administrator')))
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

-- Inventory uses the same distinction between new and historical choices.
create or replace function private.inventory_choices(org uuid,resource text,query text,after_label text,after_id uuid,selected uuid,parent uuid,active_only boolean)
returns table(id uuid,label text,active boolean,parent_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_active_organization_member(org) or not private.has_required_assurance() or
 not (private.inventory_manager(org) or exists(select 1 from public.inventory_requesters r where r.organization_id=org and r.user_id=auth.uid())) then raise exception 'Inventory access denied' using errcode='42501'; end if;
 if resource in ('inventory_assets','inventory_stored') and not private.inventory_manager(org) then raise exception 'Inventory manager permission required' using errcode='42501'; end if;
 return query with choices as (
 select p.user_id id,p.display_name label,m.status='active' active from public.profiles p join public.organization_memberships m using(organization_id,user_id) where p.organization_id=org and resource='inventory_people' and (m.deleted_at is null or p.user_id=selected)
 union all select a.id,a.tag||' · '||a.name||coalesce(' · '||a.serial_number,''),case when resource='inventory_printers' then a.status<>'retired' else a.status='available' and a.assigned_user_id is null end from public.assets a where a.organization_id=org and ((resource='inventory_printers' and a.kind='printer') or resource='inventory_assets' or (resource='inventory_stored' and exists(select 1 from public.inventory_equipment e where e.organization_id=org and e.asset_id=a.id and e.item_id=parent and e.state='stored')))
 ) select c.id,c.label,c.active,null::uuid from choices c where case when selected is not null then c.id=selected else (not active_only or c.active) and c.label ilike all(private.search_patterns(query)) and (after_id is null or (c.label,c.id)>(after_label,after_id)) end order by c.label,c.id limit 51;
end $$;
