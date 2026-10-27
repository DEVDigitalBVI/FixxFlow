begin;
alter table public.ticket_incidents add column disruption_started_at timestamptz, add column service_restored_at timestamptz;
alter table public.ticket_incidents add constraint incident_service_times check (
 (disruption_started_at is null or isfinite(disruption_started_at)) and
 (service_restored_at is null or (isfinite(service_restored_at) and disruption_started_at is not null and service_restored_at>=disruption_started_at)));
create function private.validate_incident_service_time() returns trigger language plpgsql set search_path='' as $$
begin
 if new.disruption_started_at>now() or new.service_restored_at>now() then raise exception 'Record service times in the past'; end if;
 return new;
end $$;
revoke all on function private.validate_incident_service_time() from public,anon,authenticated,service_role;
create trigger ticket_incidents_service_time before insert or update on public.ticket_incidents for each row execute function private.validate_incident_service_time();
alter table public.service_announcement_drafts add column public_status text not null default 'investigating' check(public_status in ('investigating','fixing','monitoring','resolved')),
 add column workaround text not null default '' check(char_length(workaround)<=1000),
 add column next_update_at timestamptz check(next_update_at is null or isfinite(next_update_at));
alter table public.service_announcements add column public_status text not null default 'investigating' check(public_status in ('investigating','fixing','monitoring','resolved')),
 add column workaround text not null default '' check(char_length(workaround)<=1000),
 add column next_update_at timestamptz check(next_update_at is null or isfinite(next_update_at));
create or replace function private.manage_service_announcement(org uuid,ticket uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare draft public.service_announcement_drafts; workflow public.ticket_workflows;
 ticket_status public.ticket_status; assigned uuid; request_kind text; result bigint; actor_name text; heading text; message text;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then
  raise exception 'Announcement access denied' using errcode='42501'; end if;
 -- Match ticket -> announcement lock order used by the automatic withdrawal trigger.
 select status,assigned_technician_id,public.tickets.request_kind into ticket_status,assigned,request_kind from public.tickets where organization_id=org and id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 select * into workflow from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 if request_kind='inventory' then raise exception 'Announcements are unavailable for inventory requests' using errcode='42501'; end if;
 select * into draft from public.service_announcement_drafts where organization_id=org and ticket_id=ticket;
 if expected_revision is null or expected_revision<>coalesce(draft.revision,0) then
  raise exception 'Announcement changed; review the latest saved draft' using errcode='PT409'; end if;
 if ticket_status in ('resolved','closed') then raise exception 'Reopen the ticket before publishing an announcement'; end if;
 if operation='save' then
  heading:=trim(payload->>'title'); message:=trim(payload->>'body');
  if heading is null or message is null or char_length(heading) not between 3 and 180 or char_length(message) not between 3 and 3000 then
   raise exception 'Enter a title (3–180 characters) and message (3–3000 characters)'; end if;
  insert into public.service_announcement_drafts(ticket_id,organization_id,title,body,updated_by,public_status,workaround,next_update_at)
   values(ticket,org,heading,message,auth.uid(),coalesce(payload->>'public_status','investigating'),coalesce(payload->>'workaround',''),(payload->>'next_update_at')::timestamptz) on conflict(ticket_id) do update
   set title=excluded.title,body=excluded.body,public_status=excluded.public_status,workaround=excluded.workaround,next_update_at=excluded.next_update_at,updated_by=excluded.updated_by,updated_at=now(),revision=service_announcement_drafts.revision+1
   returning revision into result;
 elsif operation in ('publish','withdraw') then
  if workflow.owner_id is distinct from auth.uid() and assigned is distinct from auth.uid() and not exists(select 1 from public.organization_memberships
    where organization_id=org and user_id=auth.uid() and status='active' and role='administrator') then
   raise exception 'Only the assignee, coordinator or an administrator can publish or remove announcements' using errcode='42501'; end if;
  if draft.ticket_id is null then raise exception 'Save and review a draft first'; end if;
  if operation='publish' then
   if payload->>'confirm' is distinct from 'yes' then raise exception 'Confirm the saved message is suitable for everyone in the workspace'; end if;
   -- Retrying the same approval never republishes or creates a second notice.
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision and withdrawn_at is null) then return draft.revision; end if;
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision) then raise exception 'Save a new draft before republishing a removed announcement'; end if;
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   insert into public.service_announcements(organization_id,ticket_id,title,body,draft_revision,published_by,public_status,workaround,next_update_at)
    values(org,ticket,draft.title,draft.body,draft.revision,auth.uid(),draft.public_status,draft.workaround,draft.next_update_at);
  else
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   if not found then return draft.revision; end if;
  end if;
  result:=draft.revision;
 else raise exception 'Unknown announcement action'; end if;
 select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),coalesce(actor_name,'IT staff'),'service_announcements',ticket,coalesce(heading,draft.title),
 'updated',jsonb_build_array(jsonb_build_object('field','announcement_action','from',null,'to',operation)));
 return result;
end $$;

create function private.publish_employee_update(org uuid,ticket uuid,expected_revision bigint,heading text,message text,request_key uuid,details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt private.service_announcement_commands; command jsonb; version bigint; announcement uuid; result jsonb;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Announcement access denied' using errcode='42501'; end if;
 if request_key is null then raise exception 'A request key is required'; end if;
 -- The same lock order is shared by legacy publication and automatic removal.
 perform 1 from public.tickets where organization_id=org and id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 command:=jsonb_build_object('ticket',ticket,'revision',expected_revision,'title',trim(heading),'body',trim(message),'details',details);
 select * into receipt from private.service_announcement_commands c where c.organization_id=org and c.request_key=publish_employee_update.request_key;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.payload is distinct from command then raise exception 'This publication request changed' using errcode='PT409'; end if;
  return receipt.result;
 end if;
 if jsonb_typeof(details) is distinct from 'object' or details->>'public_status' is null or details->>'public_status' not in ('investigating','fixing','monitoring','resolved') or char_length(coalesce(details->>'workaround',''))>1000 or (nullif(details->>'next_update_at','') is not null and (not isfinite((details->>'next_update_at')::timestamptz) or (details->>'next_update_at')::timestamptz<=now())) then raise exception 'Invalid employee update details'; end if;
 -- Both calls are in one transaction: failed authorization/publication rolls back
 -- the draft as well. Publish itself is the explicit approval of the entered text.
 version:=private.manage_service_announcement(org,ticket,expected_revision,'save',jsonb_build_object('title',heading,'body',message)||jsonb_build_object('public_status',details->>'public_status','workaround',coalesce(details->>'workaround',''),'next_update_at',details->>'next_update_at'));
 perform private.manage_service_announcement(org,ticket,version,'publish','{"confirm":"yes"}'::jsonb);
 select id into announcement from public.service_announcements where ticket_id=ticket and draft_revision=version;
 result:=jsonb_build_object('revision',version,'id',announcement,'recipients',(select count(*) from public.notifications where service_announcement_id=announcement));
 insert into private.service_announcement_commands values(org,request_key,auth.uid(),ticket,command,result);
 return result;
end $$;
revoke all on function private.publish_employee_update(uuid,uuid,bigint,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.publish_employee_update(uuid,uuid,bigint,text,text,uuid,jsonb) to authenticated;
create function public.publish_employee_update(org uuid,ticket uuid,expected_revision bigint,heading text,message text,request_key uuid,details jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.publish_employee_update(org,ticket,expected_revision,heading,message,request_key,details);
$$;
revoke all on function public.publish_employee_update(uuid,uuid,bigint,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_employee_update(uuid,uuid,bigint,text,text,uuid,jsonb) to authenticated;

create or replace function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz,reopen_reason text,service_announcement_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   (n.service_announcement_id is null and n.read_at is not null and n.kind not in ('ticket_created','ticket_assigned','ticket_reassigned')) or n.created_at<now()-interval '24 hours'
   or (n.service_announcement_id is not null and not exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id and a.withdrawn_at is null))
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (m.role in ('technician','administrator')
        or exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id)
        or exists (select 1 from public.incident_bulletin_recipients r where r.organization_id=n.organization_id and r.bulletin_id=n.incident_bulletin_id and r.user_id=m.user_id)
        or exists (select 1 from public.tickets t where t.id=n.ticket_id and t.requester_id=m.user_id)
        or exists (select 1 from public.chat_conversations c where c.id=n.conversation_id and c.requester_id=m.user_id)))
 );
 -- Never retry after the provider's 24-hour idempotency window.
 update private.notification_email_outbox set status='failed',last_error='Retry window expired'
 where status in ('pending','sending') and (attempts>=6 or first_attempt_at<now()-interval '23 hours')
 and (status='pending' or lease_until<now());
 return query with candidates as (
  select q.notification_id from private.notification_email_outbox q
  where ((q.status='pending' and q.available_at<=now()) or (q.status='sending' and q.lease_until<now()))
  order by q.available_at for update skip locked limit greatest(1,least(batch_size,20))
 ), claimed as (
  update private.notification_email_outbox q set status='sending',attempts=q.attempts+1,
   lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(q.first_attempt_at,now())
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status,q.previous_status,q.status_changed_by,q.ticket_owner,q.reopen_reason
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||case when c.ticket_priority='critical' then 'Urgent' else initcap(c.ticket_priority::text) end end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,case when a.id is not null then 'Status: '||case a.public_status when 'fixing' then 'Working on a fix' when 'monitoring' then 'Monitoring' when 'resolved' then 'Resolved' else 'Investigating' end||E'\n\n'||a.body||case when a.workaround='' then '' else E'\n\nWhat to do: '||a.workaround end else b.body end,coalesce(a.next_update_at,b.next_update_at),case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority,c.previous_status,c.status_changed_by,c.ticket_owner,n.created_at,c.reopen_reason,n.service_announcement_id
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id left join public.service_announcements a on a.id=n.service_announcement_id and a.organization_id=n.organization_id;
end;
$$;

revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
create or replace function public.save_ticket_incident(org uuid,target uuid,expected_revision bigint,payload jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; result bigint;
begin
  if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident access denied' using errcode='42501'; end if;
  select t.revision into current_revision from public.tickets t where t.id=target and t.organization_id=org for update;
  if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
  if expected_revision is null or current_revision<>expected_revision then raise exception 'Ticket changed; review saved details' using errcode='PT409'; end if;
  if jsonb_typeof(payload)<>'object' then raise exception 'Invalid incident details'; end if;
  insert into public.ticket_incidents(ticket_id,organization_id,severity,business_impact,owner_id,affected_services,affected_locations,disruption_started_at,service_restored_at)
  values(target,org,payload->>'severity',trim(payload->>'business_impact'),(payload->>'owner_id')::uuid,
    array(select jsonb_array_elements_text(coalesce(payload->'affected_services','[]'))),
    array(select jsonb_array_elements_text(coalesce(payload->'affected_locations','[]'))),
    (payload->>'disruption_started_at')::timestamptz,(payload->>'service_restored_at')::timestamptz)
  on conflict(ticket_id) do update set severity=excluded.severity,business_impact=excluded.business_impact,owner_id=excluded.owner_id,
    affected_services=excluded.affected_services,affected_locations=excluded.affected_locations,
    disruption_started_at=case when payload?'disruption_started_at' then excluded.disruption_started_at else ticket_incidents.disruption_started_at end,
    service_restored_at=case when payload?'service_restored_at' then excluded.service_restored_at else ticket_incidents.service_restored_at end;
  select revision into result from public.tickets where id=target and organization_id=org;
  return result;
end $$;
revoke all on function public.save_ticket_incident(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_ticket_incident(uuid,uuid,bigint,jsonb) to authenticated;


create function public.incident_report(org uuid, page integer default 1)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Incident report access denied' using errcode='42501'; end if;
 if page is null or page<1 or page>100000 then raise exception 'Invalid report page'; end if;
 with incidents as (
  select i.*,t.ticket_number,t.title,t.status,t.resolved_at,t.closed_at,t.created_at as ticket_created_at,
   greatest(0,extract(epoch from (coalesce(t.resolved_at,t.closed_at,now())-t.created_at))/60) as ticket_minutes,
   extract(epoch from (i.service_restored_at-i.disruption_started_at))/60 as downtime_minutes,
   (select greatest(0,extract(epoch from (min(a.published_at)-i.created_at))/60) from public.service_announcements a where a.organization_id=org and a.ticket_id=i.ticket_id) as announcement_minutes
  from public.ticket_incidents i join public.tickets t on t.organization_id=i.organization_id and t.id=i.ticket_id
  where i.organization_id=org and (i.created_at>=now()-interval '30 days' or t.status not in ('resolved','closed'))
 ), recent as (select * from incidents where created_at>=now()-interval '30 days'),
 breakdown as (
  select 'severity' kind,severity label,count(*) value from recent group by severity
  union all select 'service',name,count(*) from recent cross join lateral unnest(case when cardinality(affected_services)=0 then array['Not recorded'] else affected_services end) name group by name
  union all select 'location',name,count(*) from recent cross join lateral unnest(case when cardinality(affected_locations)=0 then array['Not recorded'] else affected_locations end) name group by name
 ), items as (
 select * from incidents order by (status not in ('resolved','closed')) desc,created_at desc,ticket_id offset ((page-1)*20) limit 21
 ) select jsonb_build_object('asOf',now(),'summary',jsonb_build_object(
 'total',(select count(*) from recent),'open',(select count(*) from incidents where status not in ('resolved','closed')),
 'announcementMinutes',(select avg(announcement_minutes) from recent),'announcementSamples',(select count(announcement_minutes) from recent),
 'resolutionMinutes',(select avg(ticket_minutes) from recent where status in ('resolved','closed')),'resolutionSamples',(select count(*) from recent where status in ('resolved','closed')),
 'downtimeMinutes',(select avg(downtime_minutes) from recent),'downtimeSamples',(select count(downtime_minutes) from recent)),
 'breakdowns',coalesce((select jsonb_agg(to_jsonb(b) order by kind,value desc,label) from breakdown b),'[]'),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',ticket_id,'number',ticket_number,'title',title,'severity',severity,'status',status,'impact',business_impact,'services',affected_services,'locations',affected_locations,'createdAt',created_at,'ticketMinutes',ticket_minutes,'downtimeMinutes',downtime_minutes,'startedAt',disruption_started_at,'restoredAt',service_restored_at) order by (status not in ('resolved','closed')) desc,created_at desc,ticket_id) from items),'[]')) into result;
 return result;
end $$;
revoke all on function public.incident_report(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.incident_report(uuid,integer) to authenticated;
create index ticket_incidents_org_created_idx on public.ticket_incidents(organization_id,created_at desc,ticket_id);
commit;
