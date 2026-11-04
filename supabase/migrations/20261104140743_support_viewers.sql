-- Curated read-only employee access. Raw ticket RLS is deliberately unchanged.
create table private.support_viewer_permissions (
 organization_id uuid not null, user_id uuid not null,
 dashboard boolean not null default false, shared_incidents boolean not null default false,
 revision integer not null default 1,
 primary key(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create table private.shared_incident_summaries (
 organization_id uuid not null, ticket_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),
 overview text not null check(length(trim(overview)) between 1 and 4000),
 resolution text not null default '' check(length(resolution)<=4000),
 published boolean not null default false, revision integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(organization_id,ticket_id),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade
);
alter table private.support_viewer_permissions enable row level security;
alter table private.shared_incident_summaries enable row level security;
revoke all on private.support_viewer_permissions,private.shared_incident_summaries from public,anon,authenticated,service_role;

create function private.support_viewer_allowed(org uuid, capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.has_required_assurance() and exists(
 select 1 from public.organization_memberships m
 left join private.support_viewer_permissions p using(organization_id,user_id)
 where m.organization_id=org and m.user_id=auth.uid() and m.status='active' and m.deleted_at is null
 and (m.role in ('administrator','technician') or (m.role='end_user' and
 case capability when 'dashboard' then coalesce(p.dashboard,false) when 'shared_incidents' then coalesce(p.shared_incidents,false) else false end)))
$$;

create function private.support_viewer_access(org uuid, members uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if members is null then
  return jsonb_build_object('dashboard',private.support_viewer_allowed(org,'dashboard'),'sharedIncidents',private.support_viewer_allowed(org,'shared_incidents'));
 end if;
 if not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) or not private.has_required_assurance() then
  raise exception 'Administrator required' using errcode='42501'; end if;
 if cardinality(members)>25 then raise exception 'Too many members' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'dashboard',coalesce(p.dashboard,false),'sharedIncidents',coalesce(p.shared_incidents,false),'revision',coalesce(p.revision,0)))
 from public.organization_memberships m left join private.support_viewer_permissions p using(organization_id,user_id)
 where m.organization_id=org and m.user_id=any(members) and m.deleted_at is null),'[]'::jsonb);
end $$;

create function private.set_support_viewer_access(org uuid, member uuid, dashboard boolean, shared_incidents boolean, expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer; previous_dashboard boolean; previous_shared boolean;
begin
 if not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) or not private.has_required_assurance() then
  raise exception 'Administrator required' using errcode='42501'; end if;
 perform 1 from public.organization_memberships m where m.organization_id=org and m.user_id=member and m.role='end_user' and m.deleted_at is null for update;
 if not found then raise exception 'Employee unavailable' using errcode='P0002'; end if;
 select revision,p.dashboard,p.shared_incidents into current_revision,previous_dashboard,previous_shared from private.support_viewer_permissions p where organization_id=org and user_id=member;
 if coalesce(current_revision,0) is distinct from expected_revision then raise exception 'Access changed; reload' using errcode='40001'; end if;
 insert into private.support_viewer_permissions values(org,member,dashboard,shared_incidents,1)
 on conflict(organization_id,user_id) do update set dashboard=excluded.dashboard,shared_incidents=excluded.shared_incidents,revision=private.support_viewer_permissions.revision+1;
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),'Administrator','organization_memberships',member,'Employee insight access','updated',jsonb_build_array(jsonb_build_object('field','support_dashboard','from',coalesce(previous_dashboard,false),'to',dashboard),jsonb_build_object('field','shared_incidents','from',coalesce(previous_shared,false),'to',shared_incidents)));
end $$;

create function private.shared_incidents(org uuid, ticket uuid default null, query text default '', page integer default 1, filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff boolean := coalesce(private.can_work_tickets(org),false) and private.has_required_assurance(); result jsonb;
begin
 if not private.support_viewer_allowed(org,'shared_incidents') then raise exception 'Shared incidents access required' using errcode='42501'; end if;
 with visible as materialized (
 select s.ticket_id,s.title,s.overview,s.resolution,s.published,s.revision,s.updated_at,t.ticket_number,t.status,t.priority,t.ticket_type
 from private.shared_incident_summaries s join public.tickets t on t.organization_id=s.organization_id and t.id=s.ticket_id
 where s.organization_id=org and (ticket is null or t.id=ticket)
 and (staff or (s.published and t.request_kind<>'inventory' and (t.ticket_type='incident' or t.priority in ('high','critical'))))
 and (filter='all' or (filter='incidents' and t.ticket_type='incident') or (filter='priority' and t.priority in ('high','critical')))
 and (trim(query)='' or strpos(lower(s.title||' '||s.overview||' '||s.resolution),lower(left(trim(query),200)))>0)
 ), bounded as (select * from visible order by updated_at desc,ticket_id limit 25 offset (greatest(1,least(coalesce(page,1),999999))-1)*25)
 select jsonb_build_object('count',(select count(*) from visible),'rows',coalesce((select jsonb_agg(to_jsonb(bounded)) from bounded),'[]'::jsonb)) into result;
 return result;
end $$;

create function private.save_shared_incident(org uuid, ticket uuid, title text, overview text, resolution text, published boolean, expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer; eligible boolean; previous_published boolean;
begin
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Staff required' using errcode='42501'; end if;
 select t.request_kind<>'inventory' and (t.ticket_type='incident' or t.priority in ('high','critical')) into eligible from public.tickets t where t.organization_id=org and t.id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='P0002'; end if;
 if published and not eligible then raise exception 'Only incidents and high or urgent priority tickets can be shared' using errcode='22023'; end if;
 if title is null or overview is null or resolution is null or published is null then raise exception 'Missing summary fields' using errcode='22023'; end if;
 select revision,s.published into current_revision,previous_published from private.shared_incident_summaries s where organization_id=org and ticket_id=ticket;
 if coalesce(current_revision,0) is distinct from expected_revision then raise exception 'Summary changed; reload' using errcode='40001'; end if;
 insert into private.shared_incident_summaries values(org,ticket,trim(title),trim(overview),trim(resolution),published,1,clock_timestamp())
 on conflict(organization_id,ticket_id) do update set title=excluded.title,overview=excluded.overview,resolution=excluded.resolution,published=excluded.published,revision=private.shared_incident_summaries.revision+1,updated_at=excluded.updated_at;
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),'IT staff','tickets',ticket,'Shared incident summary','updated',jsonb_build_array(jsonb_build_object('field','shared_incident_published','from',coalesce(previous_published,false),'to',published),jsonb_build_object('field','shared_summary_revision','from',coalesce(current_revision,0),'to',coalesce(current_revision,0)+1)));
end $$;

-- This elevated read returns only aggregates. It never changes raw-ticket access.
create function private.support_viewer_dashboard(org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare zone text; today date; result jsonb; workload jsonb;
begin
 if not private.support_viewer_allowed(org,'dashboard') then raise exception 'Dashboard access required' using errcode='42501'; end if;
 select timezone into strict zone from public.organizations where id=org;
 today := (now() at time zone zone)::date;
 with base as materialized (
 select t.status,t.sla_next_due_at,t.assigned_technician_id,
 (t.created_at at time zone zone)::date created_day,(t.first_response_at at time zone zone)::date response_day,(t.resolved_at at time zone zone)::date resolved_day,
 extract(epoch from(t.first_response_at-t.created_at))/60 response_minutes,extract(epoch from(t.resolved_at-t.created_at))/60 resolution_minutes
 from public.tickets t where t.organization_id=org and t.created_at<=now()
 ), events as materialized (
 select a.ticket_id,(a.created_at at time zone zone)::date as day,
 a.details->>'from' not in ('resolved','closed') and a.details->>'to' in ('resolved','closed') resolved,
 a.details->>'from' in ('resolved','closed') and a.details->>'to' not in ('resolved','closed') reopened
 from public.ticket_activity a where a.organization_id=org and a.action='status_changed' and a.created_at>=((today-13)::timestamp at time zone zone) and a.created_at<=now()
 ), daily as (
 select day,(select count(*) from base where created_day=days.day) created,
 (select count(distinct ticket_id) from events where events.day=days.day and resolved) resolved,
 (select count(distinct ticket_id) from events where events.day=days.day and reopened) reopened,
 (select avg(response_minutes) from base where response_day=days.day and response_minutes>=0) response,
 (select avg(resolution_minutes) from base where resolved_day=days.day and resolution_minutes>=0) resolution
 from (select today-i as day from generate_series(0,13) i) days
 ) select jsonb_build_object('asOf',now(),'timezone',zone,'today',today,'summary',jsonb_build_object(
 'created',(select count(*) from base where created_day=today),'resolved',(select count(distinct ticket_id) from events where day=today and resolved),
 'open',(select count(*) from base where status not in ('resolved','closed')),'overdue',(select count(*) from base where status not in ('resolved','closed') and sla_next_due_at<=now()),
 'response',(select avg(response_minutes) from base where response_day=today and response_minutes>=0),'resolution',(select avg(resolution_minutes) from base where resolved_day=today and resolution_minutes>=0)),
 'daily',(select jsonb_agg(to_jsonb(daily) order by day) from daily),'breakdowns','[]'::jsonb,'sla','[]'::jsonb) into result;
 with counts as (
 select t.assigned_technician_id,count(*) open_count,count(*) filter(where t.status='waiting_on_user') waiting_count,count(*) filter(where t.sla_next_due_at<=now()) overdue_count
 from public.tickets t where t.organization_id=org and t.status not in ('resolved','closed') group by t.assigned_technician_id
 ), actors as (
 select m.user_id,coalesce(nullif(trim(p.display_name),''),'IT member') label,m.status='active' and m.role in ('administrator','technician') active
 from public.organization_memberships m left join public.profiles p using(organization_id,user_id)
 where m.organization_id=org and ((m.status='active' and m.role in ('administrator','technician')) or exists(select 1 from counts c where c.assigned_technician_id=m.user_id))
 union all select null::uuid,'Unassigned',true
 ), bounded as (
 select a.label,a.active,coalesce(c.open_count,0) open_count,coalesce(c.waiting_count,0) waiting_count,coalesce(c.overdue_count,0) overdue_count
 from actors a left join counts c on c.assigned_technician_id is not distinct from a.user_id order by coalesce(c.open_count,0) desc,a.label,a.user_id nulls last limit 5
 ) select coalesce(jsonb_agg(to_jsonb(bounded)),'[]'::jsonb) into workload from bounded;
 return jsonb_build_object('report',result,'workload',workload);
end $$;

revoke all on function private.support_viewer_allowed(uuid,text) from public,anon,authenticated,service_role;

revoke all on function private.support_viewer_access(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.support_viewer_access(uuid,uuid[]) to authenticated;
create function public.support_viewer_access(org uuid, members uuid[] default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.support_viewer_access(org,members) $$;
revoke all on function public.support_viewer_access(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.support_viewer_access(uuid,uuid[]) to authenticated;

revoke all on function private.set_support_viewer_access(uuid,uuid,boolean,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function private.set_support_viewer_access(uuid,uuid,boolean,boolean,integer) to authenticated;
create function public.set_support_viewer_access(org uuid, member uuid, dashboard boolean, shared_incidents boolean, expected_revision integer) returns void
language sql security invoker set search_path='' as $$ select private.set_support_viewer_access(org,member,dashboard,shared_incidents,expected_revision) $$;
revoke all on function public.set_support_viewer_access(uuid,uuid,boolean,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_support_viewer_access(uuid,uuid,boolean,boolean,integer) to authenticated;

revoke all on function private.shared_incidents(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.shared_incidents(uuid,uuid,text,integer,text) to authenticated;
create function public.shared_incidents(org uuid, ticket uuid default null, query text default '', page integer default 1, filter text default 'all') returns jsonb
language sql security invoker set search_path='' as $$ select private.shared_incidents(org,ticket,query,page,filter) $$;
revoke all on function public.shared_incidents(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.shared_incidents(uuid,uuid,text,integer,text) to authenticated;

revoke all on function private.save_shared_incident(uuid,uuid,text,text,text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_shared_incident(uuid,uuid,text,text,text,boolean,integer) to authenticated;
create function public.save_shared_incident(org uuid, ticket uuid, title text, overview text, resolution text, published boolean, expected_revision integer) returns void
language sql security invoker set search_path='' as $$ select private.save_shared_incident(org,ticket,title,overview,resolution,published,expected_revision) $$;
revoke all on function public.save_shared_incident(uuid,uuid,text,text,text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_shared_incident(uuid,uuid,text,text,text,boolean,integer) to authenticated;

revoke all on function private.support_viewer_dashboard(uuid) from public,anon,authenticated,service_role;
grant execute on function private.support_viewer_dashboard(uuid) to authenticated;
create function public.support_viewer_dashboard(org uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.support_viewer_dashboard(org) $$;
revoke all on function public.support_viewer_dashboard(uuid) from public,anon,authenticated,service_role;
grant execute on function public.support_viewer_dashboard(uuid) to authenticated;
