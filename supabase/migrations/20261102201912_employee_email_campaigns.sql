begin;

create table private.email_announcements (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 subject text not null check(length(subject) between 3 and 180 and subject !~ E'[\r\n]'),
 body text not null check(length(body) between 3 and 6000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 queued_at timestamptz,
 member_selection uuid[]
);
create index email_announcements_org_time on private.email_announcements(organization_id,created_at desc,id desc);
create index email_announcements_actor on private.email_announcements(created_by);
create table private.email_announcement_recipients (
 campaign_id uuid not null references private.email_announcements(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 display_name text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 provider_id text,
 last_error text,
 primary key(campaign_id,user_id)
);
create index email_announcement_recipients_user on private.email_announcement_recipients(user_id);
create index email_announcement_recipients_pending on private.email_announcement_recipients(available_at,campaign_id,user_id) where status in ('pending','sending');
alter table private.email_announcements enable row level security;
alter table private.email_announcement_recipients enable row level security;
revoke all on private.email_announcements,private.email_announcement_recipients from public,anon,authenticated,service_role;

-- Auth data never leaves this narrow helper. Signup completion matches the People
-- directory, while also requiring a confirmed deliverable email for this audience.
create function private.email_announcement_audience(org uuid)
returns table(user_id uuid,email text,display_name text)
language sql stable security definer set search_path='' as $$
 select m.user_id,u.email::text,coalesce(nullif(p.display_name,''),u.email)::text
 from public.organization_memberships m join auth.users u on u.id=m.user_id
 left join public.profiles p on p.organization_id=m.organization_id and p.user_id=m.user_id
 where m.organization_id=org and m.status='active' and m.deleted_at is null
 and u.email_confirmed_at is not null and coalesce(u.email,'')<>''
 and (u.invited_at is null or coalesce(u.encrypted_password,'')<>''
   or coalesce(u.raw_app_meta_data->'providers','[]'::jsonb) ?| array['google','azure']);
$$;
revoke all on function private.email_announcement_audience(uuid) from public,anon,authenticated,service_role;

create function private.assert_email_announcement_admin(org uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.has_required_assurance(),false)
 or not coalesce(private.has_organization_role(org,array['administrator']::public.app_role[]),false) then
  raise exception 'Active administrator required' using errcode='42501';
 end if;
end $$;
revoke all on function private.assert_email_announcement_admin(uuid) from public,anon,authenticated,service_role;

create function private.prepare_email_announcement(org uuid,token uuid,heading text,message text,selected_members uuid[] default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing private.email_announcements; total integer; inserted integer; selection uuid[];
begin
 perform private.assert_email_announcement_admin(org);
 if token is null or heading is null or message is null or length(trim(heading)) not between 3 and 180
 or heading ~ E'[\r\n]' or length(trim(message)) not between 3 and 6000 then
  raise exception 'Enter a subject and message' using errcode='22023';
 end if;
 if selected_members is not null then
  if cardinality(selected_members) not between 1 and 500 or array_position(selected_members,null) is not null then
   raise exception 'Choose between one and 500 members' using errcode='22023';
  end if;
  select array_agg(distinct v order by v) into selection from unnest(selected_members) v;
  if cardinality(selection)<>cardinality(selected_members) then raise exception 'Duplicate members' using errcode='22023'; end if;
 end if;
 -- The caller's stable key owns both the content and the reviewed recipient snapshot.
 insert into private.email_announcements(id,organization_id,subject,body,created_by,member_selection)
 values(token,org,trim(heading),trim(message),auth.uid(),selection) on conflict do nothing;
 get diagnostics inserted=row_count;
 select * into existing from private.email_announcements where id=token for update;
 if existing.organization_id<>org or existing.created_by<>auth.uid() or existing.subject<>trim(heading) or existing.body<>trim(message) or existing.member_selection is distinct from selection then
  raise exception 'Draft key already used; start a new draft' using errcode='PT409';
 end if;
 if inserted=1 then
  insert into private.email_announcement_recipients(campaign_id,user_id,email,display_name)
  select token,a.user_id,a.email,a.display_name from private.email_announcement_audience(org) a
  where selection is null or a.user_id=any(selection);
  get diagnostics total=row_count;
  if total=0 or (selection is not null and total<>cardinality(selection)) then raise exception 'Selected members are unavailable' using errcode='PT422'; end if;
 end if;
 return token;
end $$;

create function private.read_email_announcements(org uuid,target uuid default null,page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare campaign private.email_announcements; result jsonb;
begin
 perform private.assert_email_announcement_admin(org);
 if page is null or page<1 or page>10000 then raise exception 'Invalid page' using errcode='22023'; end if;
 if target is not null then
  select * into campaign from private.email_announcements where id=target and organization_id=org;
  if not found then return null; end if;
  select jsonb_build_object('campaign',to_jsonb(campaign)-'created_by'-'organization_id',
   'selection',case when campaign.member_selection is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'display_name',s.display_name,'email',s.email)),'[]'::jsonb) from private.email_announcement_recipients s where s.campaign_id=target) end,
   'counts',jsonb_build_object('total',count(*),'sent',count(*) filter(where r.status='sent'),
    'failed',count(*) filter(where r.status='failed'),'skipped',count(*) filter(where r.status='skipped'),
    'pending',count(*) filter(where r.status in ('pending','sending'))),
   'recipients',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (
    select user_id,display_name,email,status from private.email_announcement_recipients where campaign_id=target
    order by display_name,user_id limit 50 offset (page-1)*50) p)) into result
  from private.email_announcement_recipients r where r.campaign_id=target;
  return result;
 end if;
 select jsonb_build_object('total',(select count(*) from private.email_announcements where organization_id=org),
 'campaigns',coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)) into result from (
  select e.id,e.subject,e.created_at,e.queued_at,count(r.user_id) total,
   count(*) filter(where r.status='sent') sent,count(*) filter(where r.status='failed') failed,
   count(*) filter(where r.status='skipped') skipped,count(*) filter(where r.status in ('pending','sending')) pending
  from (select * from private.email_announcements where organization_id=org
    order by created_at desc,id desc limit 20 offset (page-1)*20) e
  left join private.email_announcement_recipients r on r.campaign_id=e.id
  group by e.id,e.subject,e.created_at,e.queued_at order by e.created_at desc,e.id desc
 ) c;
 return result;
end $$;

create function private.queue_email_announcement(org uuid,target uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare campaign private.email_announcements; total integer; actor_name text;
begin
 perform private.assert_email_announcement_admin(org);
 select * into campaign from private.email_announcements where id=target and organization_id=org for update;
 if not found then raise exception 'Draft unavailable' using errcode='42501'; end if;
 if campaign.queued_at is not null then
  return (select count(*)::integer from private.email_announcement_recipients where campaign_id=target and status<>'skipped');
 end if;
 update private.email_announcement_recipients r set status='skipped',last_error='Member no longer eligible'
 where r.campaign_id=target and not exists(select 1 from private.email_announcement_audience(org) a where a.user_id=r.user_id and a.email=r.email);
 select count(*)::integer into total from private.email_announcement_recipients where campaign_id=target and status='pending';
 if total=0 then raise exception 'No reviewed members remain eligible' using errcode='PT422'; end if;
 update private.email_announcements set queued_at=now() where id=target;
 select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),coalesce(actor_name,'Administrator'),'email_announcements',target,campaign.subject,'created',
  jsonb_build_array(jsonb_build_object('field','email_recipients','from',null,'to',total)));
 return total;
end $$;

create function private.email_announcement_choices(org uuid,query text default '',page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.assert_email_announcement_admin(org);
 if page is null or page not between 1 and 10000 or length(coalesce(query,''))>200 then raise exception 'Invalid search' using errcode='22023'; end if;
 with choices as materialized (
  select a.* from private.email_announcement_audience(org) a
  where (a.display_name||' '||a.email) ilike all(private.search_patterns(coalesce(query,'')))
 ) select jsonb_build_object('total',(select count(*) from choices),'rows',
  (select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (
   select * from choices order by display_name,user_id limit 50 offset (page-1)*50) p)) into result;
 return result;
end $$;
create function public.email_announcement_choices(org uuid,query text default '',page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select private.email_announcement_choices(org,query,page);$$;
revoke all on function private.email_announcement_choices(uuid,text,integer),public.email_announcement_choices(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.email_announcement_choices(uuid,text,integer),public.email_announcement_choices(uuid,text,integer) to authenticated;

-- Database access is through tenant-checked wrappers; no client table grants.
create function public.prepare_email_announcement(org uuid,token uuid,heading text,message text,selected_members uuid[] default null) returns uuid
language sql security invoker set search_path='' as $$select private.prepare_email_announcement(org,token,heading,message,selected_members);$$;
create function public.read_email_announcements(org uuid,target uuid default null,page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select private.read_email_announcements(org,target,page);$$;
create function public.queue_email_announcement(org uuid,target uuid) returns integer
language sql security invoker set search_path='' as $$select private.queue_email_announcement(org,target);$$;
revoke all on function private.prepare_email_announcement(uuid,uuid,text,text,uuid[]),public.prepare_email_announcement(uuid,uuid,text,text,uuid[]),
 private.read_email_announcements(uuid,uuid,integer),public.read_email_announcements(uuid,uuid,integer),
 private.queue_email_announcement(uuid,uuid),public.queue_email_announcement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.prepare_email_announcement(uuid,uuid,text,text,uuid[]),public.prepare_email_announcement(uuid,uuid,text,text,uuid[]),
 private.read_email_announcements(uuid,uuid,integer),public.read_email_announcements(uuid,uuid,integer),
 private.queue_email_announcement(uuid,uuid),public.queue_email_announcement(uuid,uuid) to authenticated;

create function private.claim_email_announcements(batch_size integer default 5)
returns table(campaign_id uuid,user_id uuid,lease_token uuid,recipient_email text,subject text,body text,workspace_name text)
language plpgsql security definer set search_path='' as $$
begin
 -- Never retry beyond the email provider's 24-hour idempotency window.
 update private.email_announcement_recipients r set status='failed',last_error='Delivery retry limit reached',lease_until=null
 from private.email_announcements c where c.id=r.campaign_id and c.queued_at is not null and r.status in ('pending','sending')
 and (c.queued_at<now()-interval '23 hours' or (r.attempts>=5 and (r.lease_until is null or r.lease_until<clock_timestamp())));
 update private.email_announcement_recipients r set status='skipped',last_error='Member no longer eligible',lease_until=null
 from private.email_announcements c where c.id=r.campaign_id and c.queued_at is not null and r.status in ('pending','sending')
 and (r.lease_until is null or r.lease_until<clock_timestamp())
 and not exists(select 1 from private.email_announcement_audience(c.organization_id) a where a.user_id=r.user_id and a.email=r.email);
 return query with candidates as (
  select r.campaign_id,r.user_id from private.email_announcement_recipients r
  join private.email_announcements c on c.id=r.campaign_id
  where c.queued_at is not null and c.queued_at>=now()-interval '23 hours'
   and r.status in ('pending','sending') and r.available_at<=now() and (r.lease_until is null or r.lease_until<clock_timestamp())
  order by r.available_at,r.campaign_id,r.user_id for update of r skip locked limit greatest(1,least(coalesce(batch_size,5),10))
 ), claimed as (
  update private.email_announcement_recipients r set status='sending',attempts=r.attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
  from candidates c where c.campaign_id=r.campaign_id and c.user_id=r.user_id returning r.*
 ) select r.campaign_id,r.user_id,r.lease_token,r.email,c.subject,c.body,o.name from claimed r
 join private.email_announcements c on c.id=r.campaign_id join public.organizations o on o.id=c.organization_id;
end $$;
create function private.finish_email_announcement(campaign uuid,recipient uuid,token uuid,provider_id text default null,failure boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if token is null or failure is null or (not failure and coalesce(provider_id,'')='') then return false; end if;
 update private.email_announcement_recipients r set status=case when not failure then 'sent' when r.attempts>=5 then 'failed' else 'pending' end,
 provider_id=finish_email_announcement.provider_id,last_error=case when failure then 'Provider request failed' else null end,
 lease_until=null,available_at=now()+make_interval(mins=>least(60,power(2,r.attempts)::integer))
 where r.campaign_id=campaign and r.user_id=recipient and r.lease_token=token and r.status='sending' and r.lease_until>clock_timestamp();
 get diagnostics changed=row_count;
 return changed=1;
end $$;
create function public.claim_email_announcements(batch_size integer default 5)
returns table(campaign_id uuid,user_id uuid,lease_token uuid,recipient_email text,subject text,body text,workspace_name text)
language sql security invoker set search_path='' as $$select * from private.claim_email_announcements(batch_size);$$;
create function public.finish_email_announcement(campaign uuid,recipient uuid,token uuid,provider_id text default null,failure boolean default false)
returns boolean language sql security invoker set search_path='' as $$select private.finish_email_announcement(campaign,recipient,token,provider_id,failure);$$;
revoke all on function private.claim_email_announcements(integer),public.claim_email_announcements(integer),
 private.finish_email_announcement(uuid,uuid,uuid,text,boolean),public.finish_email_announcement(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.claim_email_announcements(integer),public.claim_email_announcements(integer),
 private.finish_email_announcement(uuid,uuid,uuid,text,boolean),public.finish_email_announcement(uuid,uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
