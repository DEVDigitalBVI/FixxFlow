-- Read-only client tables. One guarded command owns audience snapshots,
-- approvals and immutable publication/outbox writes in a single transaction.
create table public.incident_communication_plans (
 ticket_id uuid primary key references public.ticket_incidents(ticket_id) on delete cascade,
 organization_id uuid not null, owner_id uuid not null, next_update_at timestamptz check(next_update_at is null or isfinite(next_update_at)),
 reminded_at timestamptz, revision bigint not null default 1, updated_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,owner_id) references public.organization_memberships(organization_id,user_id)
);
create index incident_communication_plans_owner_idx on public.incident_communication_plans(organization_id,owner_id);
create index incident_communication_plans_due_idx on public.incident_communication_plans(next_update_at,ticket_id) where next_update_at is not null and reminded_at is null;
create table public.incident_stakeholder_groups (
 id uuid primary key, organization_id uuid not null, ticket_id uuid not null,
 name text not null check(char_length(trim(name)) between 2 and 100), archived boolean not null default false,
 revision bigint not null default 1, created_at timestamptz not null default now(),
 unique(organization_id,ticket_id,id),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(ticket_id) references public.ticket_incidents(ticket_id) on delete cascade
);
create index incident_stakeholder_groups_ticket_idx on public.incident_stakeholder_groups(organization_id,ticket_id,created_at,id);
create table public.incident_stakeholder_members (
 organization_id uuid not null, ticket_id uuid not null, group_id uuid not null, user_id uuid not null,
 primary key(group_id,user_id),
 foreign key(organization_id,ticket_id,group_id) references public.incident_stakeholder_groups(organization_id,ticket_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create index incident_stakeholder_members_org_group_idx on public.incident_stakeholder_members(organization_id,ticket_id,group_id);
create index incident_stakeholder_members_user_idx on public.incident_stakeholder_members(organization_id,user_id);
create table public.incident_update_drafts (
 id uuid primary key, organization_id uuid not null, ticket_id uuid not null,
 title text not null check(char_length(trim(title)) between 3 and 180),
 body text not null check(char_length(trim(body)) between 3 and 8000),
 group_ids uuid[] not null, group_names text[] not null, recipient_ids uuid[] not null check(cardinality(recipient_ids) between 1 and 500),
 next_update_at timestamptz check(next_update_at is null or isfinite(next_update_at)),
 status text not null default 'draft' check(status in ('draft','sent','discarded')),
 revision bigint not null default 1, created_by uuid not null, updated_by uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(ticket_id) references public.ticket_incidents(ticket_id) on delete cascade
);
create index incident_update_drafts_ticket_idx on public.incident_update_drafts(organization_id,ticket_id,status,created_at,id);
-- Only approved content enters this table; no internal impact/checklist data is copied.
create table public.incident_bulletins (
 id uuid primary key references public.incident_update_drafts(id) on delete cascade,
 organization_id uuid not null, ticket_id uuid not null,
 title text not null, body text not null, next_update_at timestamptz,
 prepared_by uuid not null, approved_by uuid not null, approved_at timestamptz not null default now(),
 recipient_count integer not null,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 unique(organization_id,id)
);
create index incident_bulletins_ticket_idx on public.incident_bulletins(organization_id,ticket_id,approved_at desc,id desc);
create table public.incident_bulletin_recipients (
 organization_id uuid not null, bulletin_id uuid not null, user_id uuid not null,
 primary key(bulletin_id,user_id),
 foreign key(organization_id,bulletin_id) references public.incident_bulletins(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create index incident_bulletin_recipients_user_idx on public.incident_bulletin_recipients(organization_id,user_id,bulletin_id);

do $$ declare name text; begin
 foreach name in array array['incident_communication_plans','incident_stakeholder_groups','incident_stakeholder_members','incident_update_drafts','incident_bulletins','incident_bulletin_recipients'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select on public.%I to authenticated',name);
  execute format('create policy "Staff read communication coordination" on public.%I for select to authenticated using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()))',name);
 end loop;
end $$;
create policy "Recipients read their delivery record" on public.incident_bulletin_recipients for select to authenticated
 using(user_id=(select auth.uid()) and private.is_active_organization_member(organization_id) and (select private.has_required_assurance()));
create policy "Recipients read approved updates" on public.incident_bulletins for select to authenticated
 using(private.is_active_organization_member(organization_id) and (select private.has_required_assurance())
 and exists(select 1 from public.incident_bulletin_recipients r where r.organization_id=incident_bulletins.organization_id and r.bulletin_id=incident_bulletins.id and r.user_id=(select auth.uid())));

alter table public.notifications add column incident_bulletin_id uuid references public.incident_bulletins(id) on delete cascade;
create index notifications_incident_bulletin_idx on public.notifications(incident_bulletin_id) where incident_bulletin_id is not null;
drop policy notifications_recipient on public.notifications;
create policy notifications_recipient on public.notifications for select to authenticated using (
 recipient_id=(select auth.uid()) and private.is_active_organization_member(organization_id)
 and (not staff_only or private.can_work_tickets(organization_id))
 and (case when incident_bulletin_id is not null then exists(select 1 from public.incident_bulletin_recipients r where r.organization_id=notifications.organization_id and r.bulletin_id=notifications.incident_bulletin_id and r.user_id=(select auth.uid()))
 else (ticket_id is not null and private.can_view_ticket(organization_id,ticket_id)) or (conversation_id is not null and private.can_view_chat(organization_id,conversation_id)) end)
);

-- SECURITY DEFINER is confined to private: it owns immutable publications and
-- private email-outbox writes. Every entry validates current staff, MFA and tenant.
create function private.manage_incident_communication(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare incident public.ticket_incidents; plan public.incident_communication_plans; grp public.incident_stakeholder_groups;
 draft public.incident_update_drafts; gids uuid[]; recipients uuid[]; names text[]; person uuid; result bigint; deadline timestamptz;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Communication access denied' using errcode='42501'; end if;
 select * into incident from public.ticket_incidents where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Incident unavailable' using errcode='42501'; end if;
 if operation='save_plan' then
  person:=(payload->>'owner_id')::uuid; deadline:=(payload->>'next_update_at')::timestamptz;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=person and status='active' and role in ('administrator','technician')) then raise exception 'Choose an active communication owner'; end if;
  select * into plan from public.incident_communication_plans where ticket_id=ticket;
  if expected_revision is null or coalesce(plan.revision,0)<>expected_revision then raise exception 'Communication plan changed' using errcode='PT409'; end if;
  insert into public.incident_communication_plans(ticket_id,organization_id,owner_id,next_update_at) values(ticket,org,person,deadline)
  on conflict(ticket_id) do update set owner_id=excluded.owner_id,next_update_at=excluded.next_update_at,
   reminded_at=case when row(incident_communication_plans.owner_id,incident_communication_plans.next_update_at) is distinct from row(excluded.owner_id,excluded.next_update_at) then null else incident_communication_plans.reminded_at end,
   revision=incident_communication_plans.revision+1,updated_at=now() returning revision into result;
  return result;
 elsif operation='save_group' then
  select * into grp from public.incident_stakeholder_groups where id=target and organization_id=org and ticket_id=ticket;
  if grp.id is null then
   if expected_revision is distinct from 0::bigint then raise exception 'Group changed' using errcode='PT409'; end if;
   if (select count(*) from public.incident_stakeholder_groups where ticket_id=ticket and not archived)>=20 then raise exception 'Up to 20 active groups per incident'; end if;
   insert into public.incident_stakeholder_groups(id,organization_id,ticket_id,name) values(target,org,ticket,trim(payload->>'name')) returning revision into result;
  else
   if grp.revision is distinct from expected_revision or grp.archived then raise exception 'Group changed' using errcode='PT409'; end if;
   update public.incident_stakeholder_groups set name=trim(payload->>'name'),revision=revision+1 where id=target returning revision into result;
  end if;
  return result;
 elsif operation in ('add_member','remove_member','archive_group') then
  select * into grp from public.incident_stakeholder_groups where id=target and organization_id=org and ticket_id=ticket;
  if grp.id is null or grp.archived then raise exception 'Group unavailable'; end if;
  if grp.revision is distinct from expected_revision then raise exception 'Group changed' using errcode='PT409'; end if;
  person:=(payload->>'user_id')::uuid;
  if operation='add_member' then
   if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=person and status='active') then raise exception 'Choose an active company member'; end if;
   if not exists(select 1 from public.incident_stakeholder_members where group_id=target and user_id=person) then
    if (select count(*) from public.incident_stakeholder_members where group_id=target)>=100 then raise exception 'Up to 100 members per group'; end if;
    insert into public.incident_stakeholder_members values(org,ticket,target,person);
   end if;
  elsif operation='remove_member' then delete from public.incident_stakeholder_members where group_id=target and user_id=person;
  else update public.incident_stakeholder_groups set archived=true where id=target;
  end if;
  update public.incident_stakeholder_groups set revision=revision+1 where id=target returning revision into result;return result;
 elsif operation='save_draft' then
  select * into draft from public.incident_update_drafts where id=target and organization_id=org and ticket_id=ticket;
  if draft.id is not null and draft.status<>'draft' then raise exception 'Published or discarded drafts cannot change'; end if;
  if coalesce(draft.revision,0) is distinct from expected_revision then raise exception 'Draft changed' using errcode='PT409'; end if;
  if draft.id is null and (select count(*) from public.incident_update_drafts where ticket_id=ticket and status='draft')>=20 then raise exception 'Up to 20 pending drafts per incident'; end if;
  gids:=array(select distinct value::uuid from jsonb_array_elements_text(payload->'group_ids'));
  if cardinality(gids) not between 1 and 10 or (select count(*) from public.incident_stakeholder_groups where organization_id=org and ticket_id=ticket and id=any(gids) and not archived)<>cardinality(gids) then raise exception 'Choose 1–10 active stakeholder groups'; end if;
  select array_agg(g.name order by g.name) into names from public.incident_stakeholder_groups g where id=any(gids);
  select array_agg(distinct m.user_id order by m.user_id) into recipients from public.incident_stakeholder_members m join public.organization_memberships u on u.organization_id=m.organization_id and u.user_id=m.user_id where m.organization_id=org and m.ticket_id=ticket and m.group_id=any(gids) and u.status='active';
  if coalesce(cardinality(recipients),0) not between 1 and 500 then raise exception 'Choose groups with 1–500 active recipients in total'; end if;
  insert into public.incident_update_drafts(id,organization_id,ticket_id,title,body,group_ids,group_names,recipient_ids,next_update_at,created_by,updated_by)
  values(target,org,ticket,trim(payload->>'title'),trim(payload->>'body'),gids,names,recipients,(payload->>'next_update_at')::timestamptz,auth.uid(),auth.uid())
  on conflict(id) do update set title=excluded.title,body=excluded.body,group_ids=excluded.group_ids,group_names=excluded.group_names,recipient_ids=excluded.recipient_ids,next_update_at=excluded.next_update_at,revision=incident_update_drafts.revision+1,updated_by=auth.uid(),updated_at=now() where incident_update_drafts.organization_id=org and incident_update_drafts.ticket_id=ticket and incident_update_drafts.status='draft' and incident_update_drafts.revision=expected_revision returning revision into result;
  if result is null then raise exception 'Draft unavailable' using errcode='42501'; end if;
  return result;
 elsif operation in ('publish','discard_draft') then
  select * into draft from public.incident_update_drafts where id=target and organization_id=org and ticket_id=ticket;
  if draft.id is null then raise exception 'Draft unavailable'; end if;
  if operation='publish' then
   if incident.owner_id<>auth.uid() and not exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active' and role='administrator') then raise exception 'Only the incident owner or an administrator can approve updates' using errcode='42501'; end if;
   -- Successful retries never enqueue a second publication or email.
   if draft.status='sent' then return draft.revision; end if;
  end if;
  if draft.status<>'draft' or draft.revision is distinct from expected_revision then raise exception 'Draft changed' using errcode='PT409'; end if;
  if operation='discard_draft' then update public.incident_update_drafts set status='discarded',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target returning revision into result;return result;end if;
  -- Never silently substitute a different audience after approval preview.
  perform 1 from public.organization_memberships where organization_id=org and user_id=any(draft.recipient_ids) order by user_id for share;
  if (select count(*) from public.organization_memberships where organization_id=org and user_id=any(draft.recipient_ids) and status='active')<>cardinality(draft.recipient_ids) then raise exception 'Recipients changed; save the draft again to refresh its audience'; end if;
  insert into public.incident_bulletins(id,organization_id,ticket_id,title,body,next_update_at,prepared_by,approved_by,recipient_count)
  values(target,org,ticket,draft.title,draft.body,draft.next_update_at,draft.created_by,auth.uid(),cardinality(draft.recipient_ids));
  insert into public.incident_bulletin_recipients select org,target,unnest(draft.recipient_ids);
  foreach person in array draft.recipient_ids loop
   perform private.enqueue_notification(org,person,null,ticket,null,'incident_update',draft.title,false,'incident-update:'||target||':'||person);
   update public.notifications set incident_bulletin_id=target where organization_id=org and recipient_id=person and event_key='incident-update:'||target||':'||person;
  end loop;
  insert into public.incident_communication_plans(ticket_id,organization_id,owner_id,next_update_at) values(ticket,org,incident.owner_id,draft.next_update_at)
  on conflict(ticket_id) do update set next_update_at=excluded.next_update_at,reminded_at=null,revision=incident_communication_plans.revision+1,updated_at=now();
  update public.incident_update_drafts set status='sent',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target returning revision into result;
  return result;
 end if;
 raise exception 'Communication action unavailable';
end $$;
revoke all on function private.manage_incident_communication(uuid,uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function private.manage_incident_communication(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;
create function public.manage_incident_communication(org uuid,ticket uuid,target uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language sql security invoker set search_path='' as $$select private.manage_incident_communication(org,ticket,target,expected_revision,operation,payload)$$;
revoke all on function public.manage_incident_communication(uuid,uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.manage_incident_communication(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;

-- Database cron also creates in-app reminders when HTTP/email delivery is offline.
create function public.enqueue_incident_update_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare plan record; total integer:=0;
begin
 for plan in select p.* from public.incident_communication_plans p join public.tickets t on t.id=p.ticket_id and t.organization_id=p.organization_id where p.next_update_at<=now() and p.reminded_at is null and t.status not in ('resolved','closed') and exists(select 1 from public.organization_memberships m where m.organization_id=p.organization_id and m.user_id=p.owner_id and m.status='active' and m.role in ('technician','administrator')) order by p.next_update_at,p.ticket_id for update of p skip locked limit 200 loop
  perform private.enqueue_notification(plan.organization_id,plan.owner_id,null,plan.ticket_id,null,'incident_update_due','Stakeholder update is due',true,'incident-update-due:'||plan.ticket_id||':'||plan.revision);
  update public.incident_communication_plans set reminded_at=now() where ticket_id=plan.ticket_id;
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.enqueue_incident_update_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_incident_update_reminders() to service_role;
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('fixxflow-incident-update-reminders','* * * * *','select public.enqueue_incident_update_reminders()');end if;
end $$;

drop function public.claim_notification_emails(integer);
create function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   n.read_at is not null or n.created_at<now()-interval '24 hours'
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (m.role in ('technician','administrator')
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
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token
 ) select c.notification_id,c.lease_token,u.email::text,n.title,n.ticket_id,n.conversation_id,n.incident_bulletin_id,b.body,b.next_update_at
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id;
end;
$$;


revoke all on function public.claim_notification_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

create function private.incident_delivery_summary(org uuid,ticket uuid,bulletins uuid[])
returns table(bulletin_id uuid,total bigint,sent bigint,pending bigint,skipped bigint,failed bigint)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Communication access denied' using errcode='42501'; end if;
 if cardinality(bulletins)>50 then raise exception 'Up to 50 updates per page'; end if;
 return query select n.incident_bulletin_id,count(*),count(*) filter(where q.status='sent'),count(*) filter(where q.status in ('pending','sending')),count(*) filter(where q.status='skipped'),count(*) filter(where q.status='failed')
 from public.notifications n left join private.notification_email_outbox q on q.notification_id=n.id
 where n.organization_id=org and n.ticket_id=ticket and n.incident_bulletin_id=any(bulletins) group by n.incident_bulletin_id;
end $$;
revoke all on function private.incident_delivery_summary(uuid,uuid,uuid[]) from public,anon;
grant execute on function private.incident_delivery_summary(uuid,uuid,uuid[]) to authenticated;
create function public.incident_delivery_summary(org uuid,ticket uuid,bulletins uuid[])
returns table(bulletin_id uuid,total bigint,sent bigint,pending bigint,skipped bigint,failed bigint)
language sql security invoker set search_path='' as $$ select * from private.incident_delivery_summary(org,ticket,bulletins) $$;
revoke all on function public.incident_delivery_summary(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.incident_delivery_summary(uuid,uuid,uuid[]) to authenticated;
