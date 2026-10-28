begin;
create table public.notification_preferences (
 organization_id uuid not null, user_id uuid not null default auth.uid(),
 email_mode text not null default 'immediate' check(email_mode in ('immediate','daily','off')),
 timezone text not null, digest_hour integer not null default 8 check(digest_hour between 0 and 23),
 quiet_enabled boolean not null default false, quiet_start time not null default '22:00', quiet_end time not null default '07:00',
 urgent_immediate boolean not null default true, digest_not_before timestamptz not null default now(), revision bigint not null default 1,
 primary key(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade,
 check(not quiet_enabled or quiet_start<>quiet_end)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public,anon,authenticated;
grant select on public.notification_preferences to authenticated;
grant insert(organization_id,user_id,email_mode,timezone,digest_hour,quiet_enabled,quiet_start,quiet_end,urgent_immediate),
 update(email_mode,timezone,digest_hour,quiet_enabled,quiet_start,quiet_end,urgent_immediate) on public.notification_preferences to authenticated;
grant select on public.notification_preferences to service_role;
create policy own_notification_preferences on public.notification_preferences for all to authenticated
 using(user_id=(select auth.uid()) and private.is_active_organization_member(organization_id))
 with check(user_id=(select auth.uid()) and private.is_active_organization_member(organization_id));
create policy notification_preferences_assurance on public.notification_preferences as restrictive for all to authenticated
 using((select private.has_required_assurance())) with check((select private.has_required_assurance()));
-- Use local calendar days, not 24 elapsed hours, across DST changes. The slot
-- remains yesterday's when a late-evening summary is released next morning.
create function private.notification_digest_slot(p public.notification_preferences,stamp timestamptz) returns timestamptz
language plpgsql stable set search_path='' as $$
declare day date:=(stamp at time zone p.timezone)::date; result timestamptz;
begin
 result:=(day+make_interval(hours=>p.digest_hour)) at time zone p.timezone;
 if result>stamp then result:=((day-1)+make_interval(hours=>p.digest_hour)) at time zone p.timezone; end if;
 return result;
end $$;
revoke all on function private.notification_digest_slot(public.notification_preferences,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.notification_digest_slot(public.notification_preferences,timestamptz) to authenticated;
create function private.prepare_notification_preferences() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Choose a valid timezone' using errcode='22023'; end if;
 if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
 if tg_op='INSERT' or (new.email_mode='daily' and (old.email_mode<>'daily' or new.timezone<>old.timezone or new.digest_hour<>old.digest_hour)) then
   new.digest_not_before:=(((private.notification_digest_slot(new,now()) at time zone new.timezone)::date+1)+make_interval(hours=>new.digest_hour)) at time zone new.timezone;
 end if;
 return new;
end $$;
revoke all on function private.prepare_notification_preferences() from public,anon,authenticated,service_role;
create trigger notification_preferences_prepare before insert or update on public.notification_preferences for each row execute function private.prepare_notification_preferences();
create function public.save_notification_preferences(org uuid,expected_revision bigint,settings jsonb) returns bigint
language plpgsql security invoker set search_path='' as $$
declare result bigint;
begin
 if auth.uid() is null or private.is_active_organization_member(org) is not true or private.has_required_assurance() is not true then raise exception 'Active member required' using errcode='42501'; end if;
 if expected_revision is null or expected_revision<0 or jsonb_typeof(settings) is distinct from 'object' or (settings-array['email_mode','timezone','digest_hour','quiet_enabled','quiet_start','quiet_end','urgent_immediate'])<>'{}'::jsonb then raise exception 'Invalid preferences' using errcode='22023'; end if;
 if expected_revision>0 and not exists(select 1 from public.notification_preferences where organization_id=org and user_id=auth.uid()) then raise exception 'Preferences changed; reload before saving' using errcode='40001'; end if;
 insert into public.notification_preferences(organization_id,user_id,email_mode,timezone,digest_hour,quiet_enabled,quiet_start,quiet_end,urgent_immediate)
 values(org,auth.uid(),settings->>'email_mode',settings->>'timezone',(settings->>'digest_hour')::integer,(settings->>'quiet_enabled')::boolean,(settings->>'quiet_start')::time,(settings->>'quiet_end')::time,(settings->>'urgent_immediate')::boolean)
 on conflict(organization_id,user_id) do update set email_mode=excluded.email_mode,timezone=excluded.timezone,digest_hour=excluded.digest_hour,quiet_enabled=excluded.quiet_enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,urgent_immediate=excluded.urgent_immediate
 where notification_preferences.revision=expected_revision
 returning revision into result;
 if result is null then raise exception 'Preferences changed; reload before saving' using errcode='40001'; end if;
 return result;
end $$;
revoke all on function public.save_notification_preferences(uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_notification_preferences(uuid,bigint,jsonb) to authenticated;

create function private.notification_quiet(p public.notification_preferences,stamp timestamptz) returns boolean
language sql stable set search_path='' as $$
 select coalesce(p.quiet_enabled and case when p.quiet_start<p.quiet_end then (stamp at time zone p.timezone)::time>=p.quiet_start and (stamp at time zone p.timezone)::time<p.quiet_end
 else (stamp at time zone p.timezone)::time>=p.quiet_start or (stamp at time zone p.timezone)::time<p.quiet_end end,false);
$$;
create function private.notification_email_mode(n public.notifications) returns text
language plpgsql stable security definer set search_path='' as $$
declare p public.notification_preferences; urgent boolean;
begin
 -- Workspace-wide announcements retain their separately authorized delivery.
 if n.service_announcement_id is not null then return 'immediate'; end if;
 select * into p from public.notification_preferences where organization_id=n.organization_id and user_id=n.recipient_id;
 if not found then return 'immediate'; end if;
 if p.email_mode='off' then return 'off'; end if;
 urgent:=n.kind in ('sla_approaching','incident_escalation') or exists(select 1 from public.tickets where organization_id=n.organization_id and id=n.ticket_id and priority='critical');
 if p.urgent_immediate and urgent then return 'immediate'; end if;
 if private.notification_quiet(p,now()) then return 'quiet'; end if;
 -- Once attempted, retain the original individual delivery/idempotency key.
 if exists(select 1 from private.notification_email_outbox q where q.notification_id=n.id and q.first_attempt_at is not null) then return 'immediate'; end if;
 return case when p.email_mode='daily' then 'digest' else 'immediate' end;
end $$;
revoke all on function private.notification_quiet(public.notification_preferences,timestamptz),private.notification_email_mode(public.notifications) from public,anon,authenticated,service_role;

create function private.notification_email_current(n public.notifications) returns boolean
language sql stable security definer set search_path='' as $$ select not ((n.service_announcement_id is null and n.read_at is not null and n.kind not in ('ticket_created','ticket_assigned','ticket_reassigned')) or n.created_at<now()-case when exists(select 1 from public.notification_preferences p where p.organization_id=n.organization_id and p.user_id=n.recipient_id and (p.email_mode='daily' or p.quiet_enabled)) then interval '72 hours' else interval '24 hours' end
   or (n.service_announcement_id is not null and not exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id and a.withdrawn_at is null))
   or (n.inventory_item_id is not null and not exists(select 1 from public.inventory_managers g join public.inventory_items i on i.organization_id=g.organization_id where g.organization_id=n.organization_id and g.user_id=n.recipient_id and i.id=n.inventory_item_id and i.reorder_threshold is not null and i.stock-i.reserved<=i.reorder_threshold and n.event_key='stock:'||i.id||':'||i.low_stock_episode))
   or (n.asset_id is not null and not exists(select 1 from public.assets a where a.organization_id=n.organization_id and a.id=n.asset_id and a.status<>'retired' and (n.event_key like 'asset:'||a.id||':warranty:'||a.warranty_until||':%' or n.event_key like 'asset:'||a.id||':end_of_life:'||a.end_of_life_on||':%')))
   or not exists (select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
     where m.organization_id=n.organization_id and m.user_id=n.recipient_id and m.status='active'
      and u.email_confirmed_at is not null and u.email is not null
      and (not n.staff_only or m.role in ('technician','administrator'))
      and (exists(select 1 from public.inventory_managers g where n.inventory_item_id is not null and g.organization_id=n.organization_id and g.user_id=m.user_id) or m.role in ('technician','administrator')
        or exists(select 1 from public.service_announcements a where a.id=n.service_announcement_id and a.organization_id=n.organization_id)
        or exists (select 1 from public.incident_bulletin_recipients r where r.organization_id=n.organization_id and r.bulletin_id=n.incident_bulletin_id and r.user_id=m.user_id)
        or exists (select 1 from public.tickets t where t.id=n.ticket_id and t.requester_id=m.user_id)
        or exists (select 1 from public.chat_conversations c where c.id=n.conversation_id and c.requester_id=m.user_id)))); $$;
revoke all on function private.notification_email_current(public.notifications) from public,anon,authenticated,service_role;

create table private.notification_digests (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,user_id uuid not null,local_day date not null,
 recipient_email text not null,workspace_name text not null,items jsonb not null,notification_ids uuid[] not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','skipped','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),first_attempt_at timestamptz,
 lease_token uuid,lease_until timestamptz,provider_id text,delivered_at timestamptz,
 unique(organization_id,user_id,local_day),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
alter table private.notification_digests enable row level security;
revoke all on private.notification_digests from public,anon,authenticated,service_role;
create index notification_digests_ready on private.notification_digests(available_at) where status in ('pending','sending');
alter table private.notification_email_outbox add column digest_id uuid references private.notification_digests(id);
create index notification_email_digest_fk on private.notification_email_outbox(digest_id) where digest_id is not null;
create or replace function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz,reopen_reason text,service_announcement_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   not private.notification_email_current(n) or private.notification_email_mode(n)='off'
 );
 -- Never retry after the provider's 24-hour idempotency window.
 update private.notification_email_outbox set status='failed',last_error='Retry window expired'
 where status in ('pending','sending') and (attempts>=6 or first_attempt_at<now()-interval '23 hours')
 and (status='pending' or lease_until<now());
 return query with candidates as (
  select q.notification_id from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id
  where q.digest_id is null and private.notification_email_mode(n)='immediate' and ((q.status='pending' and q.available_at<=now()) or (q.status='sending' and q.lease_until<now()))
  order by q.available_at for update of q skip locked limit greatest(1,least(batch_size,20))
 ), claimed as (
  update private.notification_email_outbox q set status='sending',attempts=q.attempts+1,
   lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(q.first_attempt_at,now())
  from candidates c where q.notification_id=c.notification_id returning q.notification_id,q.lease_token,q.ticket_name,q.ticket_priority,q.email_reason_version,q.reply_author,q.reply_preview,q.reply_created_at,q.ticket_status,q.previous_status,q.status_changed_by,q.ticket_owner,q.reopen_reason
 ) select c.notification_id,c.lease_token,u.email::text,(case when c.ticket_name is null then n.title else n.title||' — '||c.ticket_name end)||case when c.ticket_priority is null then '' else ' · Priority: '||case when c.ticket_priority='critical' then 'Urgent' else initcap(c.ticket_priority::text) end end,n.ticket_id,n.conversation_id,n.incident_bulletin_id,case when a.id is not null then 'Status: '||case a.public_status when 'fixing' then 'Working on a fix' when 'monitoring' then 'Monitoring' when 'resolved' then 'Resolved' else 'Investigating' end||E'\n\n'||a.body||case when a.workaround='' then '' else E'\n\nWhat to do: '||a.workaround end else b.body end,coalesce(a.next_update_at,b.next_update_at),case when c.email_reason_version=1 then n.kind::text else null end,c.reply_author,c.reply_preview,c.reply_created_at,c.ticket_status,c.ticket_priority,c.previous_status,c.status_changed_by,c.ticket_owner,n.created_at,c.reopen_reason,n.service_announcement_id
 from claimed c join public.notifications n on n.id=c.notification_id join auth.users u on u.id=n.recipient_id left join public.incident_bulletins b on b.id=n.incident_bulletin_id and b.organization_id=n.organization_id left join public.service_announcements a on a.id=n.service_announcement_id and a.organization_id=n.organization_id;
end;
$$;


create function private.claim_notification_digests(batch_size integer) returns table(digest_id uuid,lease_token uuid,recipient_email text,workspace_name text,items jsonb,total integer,local_day date)
language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences; selected_ids uuid[]; selected_items jsonb; day date; address text; workspace text; created uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 -- Lock the preference row before creating a daily batch; overlapping cron runs
 -- cannot divide the same recipient's day or capture the same outbox rows.
 for p in select pref.* from public.notification_preferences pref
 where pref.email_mode='daily' and not private.notification_quiet(pref,now())
 and now()>=pref.digest_not_before
 and not exists(select 1 from private.notification_digests d where d.organization_id=pref.organization_id and d.user_id=pref.user_id and d.local_day=(private.notification_digest_slot(pref,now()) at time zone pref.timezone)::date)
 and exists(select 1 from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id
   where n.organization_id=pref.organization_id and n.recipient_id=pref.user_id and n.created_at<=private.notification_digest_slot(pref,now()) and q.status='pending' and q.digest_id is null and q.available_at<=now() and private.notification_email_mode(n)='digest' and private.notification_email_current(n))
 order by pref.organization_id,pref.user_id for update skip locked limit greatest(1,least(batch_size,5))
 loop
  day:=(private.notification_digest_slot(p,now()) at time zone p.timezone)::date;
  select u.email,o.name into address,workspace from auth.users u join public.organizations o on o.id=p.organization_id where u.id=p.user_id;
  with selected as (
   select q.notification_id,n.title,n.ticket_id,n.conversation_id,n.incident_bulletin_id,n.asset_id,n.inventory_item_id,n.created_at
   from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id
   where n.organization_id=p.organization_id and n.recipient_id=p.user_id and n.created_at<=private.notification_digest_slot(p,now()) and q.status='pending' and q.digest_id is null and q.available_at<=now()
    and private.notification_email_mode(n)='digest' and private.notification_email_current(n)
   order by n.created_at,n.id for update of q skip locked limit 100
  ) select array_agg(notification_id order by created_at,notification_id),jsonb_agg(jsonb_build_object('title',title,'href',case
    when asset_id is not null then '/app/assets/'||asset_id when inventory_item_id is not null then '/app/inventory/'||inventory_item_id
    when incident_bulletin_id is not null then '/app/incident-updates/'||incident_bulletin_id
    when conversation_id is not null then '/app/chat/'||conversation_id when ticket_id is not null then '/app/tickets/'||ticket_id else '/app/notifications' end) order by created_at,notification_id)
  into selected_ids,selected_items from selected;
  if coalesce(cardinality(selected_ids),0)=0 then continue; end if;
  insert into private.notification_digests(organization_id,user_id,local_day,recipient_email,workspace_name,items,notification_ids)
   values(p.organization_id,p.user_id,day,address,workspace,selected_items,selected_ids) returning id into created;
  update private.notification_email_outbox q set digest_id=created where q.notification_id=any(selected_ids);
 end loop;
 -- Recheck live recipient and target access before every retry. Never rewrite a
 -- captured provider payload under the same idempotency key.
 update private.notification_digests d set status='skipped' where d.status in ('pending','sending') and (d.status='pending' or d.lease_until<now()) and (
  not exists(select 1 from public.notification_preferences pref join auth.users u on u.id=pref.user_id where pref.organization_id=d.organization_id and pref.user_id=d.user_id and pref.email_mode='daily' and u.email=d.recipient_email)
  or exists(select 1 from unnest(d.notification_ids) x(id) left join public.notifications n on n.id=x.id where n.id is null or private.notification_email_current(n) is not true));
 update private.notification_digests set status='failed' where status in ('pending','sending') and (status='pending' or lease_until<now()) and (attempts>=6 or first_attempt_at<now()-interval '23 hours');
 update private.notification_email_outbox q set status=d.status from private.notification_digests d where q.digest_id=d.id and d.status in ('skipped','failed') and q.status='pending';
 return query with candidates as (
  select d.id from private.notification_digests d join public.notification_preferences pref on pref.organization_id=d.organization_id and pref.user_id=d.user_id
  where ((d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.lease_until<now())) and not private.notification_quiet(pref,now())
  order by d.available_at,d.id for update of d skip locked limit greatest(1,least(batch_size,5))
 ), claimed as (
  update private.notification_digests d set status='sending',attempts=d.attempts+1,first_attempt_at=coalesce(d.first_attempt_at,now()),lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
  from candidates c where d.id=c.id returning d.*
 ) select d.id,d.lease_token,d.recipient_email,d.workspace_name,d.items,cardinality(d.notification_ids),d.local_day from claimed d;
end $$;
revoke all on function private.claim_notification_digests(integer) from public,anon,authenticated,service_role;
create function public.claim_notification_digests(batch_size integer default 3)
returns table(digest_id uuid,lease_token uuid,recipient_email text,workspace_name text,items jsonb,total integer,local_day date)
language sql security invoker set search_path='' as $$ select * from private.claim_notification_digests(batch_size); $$;
grant execute on function private.claim_notification_digests(integer) to service_role;
revoke all on function public.claim_notification_digests(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_digests(integer) to service_role;

create function private.finish_notification_digest(target uuid,token uuid,provider_message_id text,failure boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.notification_digests;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if failure is null then raise exception 'Delivery outcome required' using errcode='22023'; end if;
 select * into d from private.notification_digests where id=target for update;
 if not found or d.status<>'sending' or d.lease_token is distinct from token or d.lease_until<=clock_timestamp() then return false; end if;
 if not failure and (provider_message_id is null or length(trim(provider_message_id))=0) then raise exception 'Delivery ID required' using errcode='22023'; end if;
 update private.notification_digests set status=case when failure then 'pending' else 'sent' end,
 available_at=now()+make_interval(mins=>least(60,power(2,d.attempts)::integer)),lease_token=null,lease_until=null,
 provider_id=case when failure then null else provider_message_id end,delivered_at=case when failure then null else now() end where id=d.id;
 if not failure then update private.notification_email_outbox q set status='sent',delivered_at=now(),provider_id=provider_message_id where q.digest_id=d.id; end if;
 return true;
end $$;
revoke all on function private.finish_notification_digest(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
create function public.finish_notification_digest(target uuid,token uuid,provider_message_id text,failure boolean) returns boolean
language sql security invoker set search_path='' as $$ select private.finish_notification_digest(target,token,provider_message_id,failure); $$;
revoke all on function public.finish_notification_digest(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_notification_digest(uuid,uuid,text,boolean),private.finish_notification_digest(uuid,uuid,text,boolean) to service_role;
commit;
