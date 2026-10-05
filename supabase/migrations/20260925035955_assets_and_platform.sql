-- Tenant equipment inventory. No destructive API; retirement preserves history.
create table public.assets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 tag text not null check(length(trim(tag)) between 1 and 60), name text not null check(length(trim(name)) between 2 and 160),
 kind text not null check(kind in ('computer','phone','printer','network','software','other')),
 status text not null default 'available' check(status in ('available','in_use','repair','retired')),
 serial_number text check(length(serial_number)<=120), model text check(length(model)<=160),
 assigned_user_id uuid, location_id uuid, purchased_on date, warranty_until date,
 search_document tsvector generated always as (to_tsvector('simple'::regconfig,name||' '||tag||' '||coalesce(serial_number,'')||' '||coalesce(model,''))) stored,
 revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,tag),
 foreign key(organization_id,assigned_user_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 check(warranty_until is null or purchased_on is null or warranty_until>=purchased_on),
 check(status<>'retired' or assigned_user_id is null)
);
create index assets_search on public.assets using gin(search_document);
create index assets_org_updated on public.assets(organization_id,updated_at desc,id);
create index assets_assignee on public.assets(organization_id,assigned_user_id);
create index assets_location on public.assets(organization_id,location_id);
alter table public.assets enable row level security;
revoke all on public.assets from public,anon,authenticated;
grant select,insert,update on public.assets to authenticated;
create policy assets_read on public.assets for select to authenticated using(private.can_work_tickets(organization_id) or (private.is_active_organization_member(organization_id) and assigned_user_id=auth.uid()));
create policy assets_insert on public.assets for insert to authenticated with check(private.can_work_tickets(organization_id));
create policy assets_update on public.assets for update to authenticated using(private.can_work_tickets(organization_id)) with check(private.can_work_tickets(organization_id));
create policy assets_mfa on public.assets as restrictive to authenticated using((select private.has_required_assurance())) with check((select private.has_required_assurance()));
create function private.prepare_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.organization_id<>old.organization_id or new.created_at<>old.created_at then raise exception 'Asset identity is immutable'; end if;
  new.revision:=old.revision+1;
 else new.revision:=1; end if;
 new.tag:=upper(trim(new.tag)); new.name:=trim(new.name); new.updated_at:=now();
 if new.assigned_user_id is not null and (tg_op='INSERT' or new.assigned_user_id is distinct from old.assigned_user_id) and not exists(select 1 from public.organization_memberships where organization_id=new.organization_id and user_id=new.assigned_user_id and status='active') then raise exception 'Choose an active member'; end if;
 return new;
end $$;
revoke all on function private.prepare_asset() from public,anon,authenticated;
create trigger prepare_asset before insert or update on public.assets for each row execute function private.prepare_asset();
create table public.ticket_assets (
 organization_id uuid not null, ticket_id uuid not null, asset_id uuid not null, created_at timestamptz not null default now(),
 primary key(organization_id,ticket_id,asset_id),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id),
 foreign key(organization_id,asset_id) references public.assets(organization_id,id)
);
create index ticket_assets_asset on public.ticket_assets(organization_id,asset_id);
alter table public.ticket_assets enable row level security;
revoke all on public.ticket_assets from public,anon,authenticated;
grant select,insert,delete on public.ticket_assets to authenticated;
create policy ticket_assets_staff on public.ticket_assets for all to authenticated using(private.can_work_tickets(organization_id)) with check(private.can_work_tickets(organization_id));
create policy ticket_assets_mfa on public.ticket_assets as restrictive to authenticated using((select private.has_required_assurance())) with check((select private.has_required_assurance()));

create function private.audit_asset() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; previous jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end; delta jsonb:='[]'; k text; actor_name text; label text; fields text[];
begin
 select p.display_name into actor_name from public.profiles p where p.organization_id=(r->>'organization_id')::uuid and p.user_id=auth.uid();
 if tg_table_name='assets' then label:=(r->>'tag')||' · '||(r->>'name'); fields:=array['tag','name','kind','status','serial_number','model','assigned_user_id','location_id','purchased_on','warranty_until'];
 else select a.tag||' · Ticket #'||t.ticket_number into label from public.assets a join public.tickets t on t.organization_id=a.organization_id where a.id=(r->>'asset_id')::uuid and t.id=(r->>'ticket_id')::uuid; fields:=array['asset_id','ticket_id']; end if;
 foreach k in array fields loop
  if tg_op<>'UPDATE' or previous->k is distinct from r->k then delta:=delta||jsonb_build_array(jsonb_build_object('field',k,'from',case when tg_op='INSERT' then null else previous->k end,'to',case when tg_op='DELETE' then null else r->k end)); end if;
 end loop;
 if jsonb_array_length(delta)>0 then
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes) values((r->>'organization_id')::uuid,auth.uid(),coalesce(actor_name,'System'),tg_table_name,coalesce(r->>'id',r->>'asset_id')::uuid,label,case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.audit_asset() from public,anon,authenticated;
create trigger audit_asset after insert or update on public.assets for each row execute function private.audit_asset();
create trigger audit_asset_link after insert or delete on public.ticket_assets for each row execute function private.audit_asset();

-- A distinct platform role, deliberately unrelated to tenant administrator roles.
create table private.platform_owners(user_id uuid primary key references auth.users(id), created_at timestamptz not null default now());
create table private.platform_audit(id bigint generated always as identity primary key,actor_id uuid not null,organization_id uuid,action text not null,details jsonb not null,created_at timestamptz not null default now());
create index platform_audit_time on private.platform_audit(created_at desc,id desc);
alter table private.platform_owners enable row level security;
alter table private.platform_audit enable row level security;
revoke all on private.platform_owners,private.platform_audit from public,anon,authenticated;
create policy platform_owners_denied on private.platform_owners to authenticated using(false);
create policy platform_audit_denied on private.platform_audit to authenticated using(false);
create trigger platform_audit_immutable before update or delete on private.platform_audit for each row execute function private.protect_audit_event();
create function private.platform_access() returns text language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null or not exists(select 1 from private.platform_owners where user_id=auth.uid()) or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now())) then 'none'
 when not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') then 'enroll'
 when auth.jwt()->>'aal' is distinct from 'aal2' then 'verify' else 'ready' end;
$$;
revoke all on function private.platform_access() from public,anon;
grant execute on function private.platform_access() to authenticated;
create function public.platform_access() returns text language sql stable security invoker set search_path='' as $$select private.platform_access();$$;
revoke all on function public.platform_access() from public,anon;
grant execute on function public.platform_access() to authenticated;

-- Narrow, checked RPCs expose only organization administration metadata and aggregates.
create function private.platform_overview(search_text text,page_number integer,days integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if private.platform_access()<>'ready' then raise exception 'Platform owner verification required' using errcode='42501'; end if;
 select jsonb_build_object(
 'organizations',coalesce((select jsonb_agg(row) from (select o.id,o.name,o.slug,o.created_at,(select count(*) from public.organization_memberships m where m.organization_id=o.id and m.status='active') members from public.organizations o where o.name ilike '%'||left(coalesce(search_text,''),100)||'%' or o.slug ilike '%'||left(coalesce(search_text,''),100)||'%' order by o.created_at desc,o.id limit 25 offset (greatest(1,least(coalesce(page_number,1),100000))-1)*25) row),'[]'::jsonb),
 'organizationCount',(select count(*) from public.organizations),
 'matchingCount',(select count(*) from public.organizations o where o.name ilike '%'||left(coalesce(search_text,''),100)||'%' or o.slug ilike '%'||left(coalesce(search_text,''),100)||'%'),
 'usage',coalesce((select jsonb_agg(row) from (select event,role,surface,sum(count) count from private.product_usage_counts where day>=(now() at time zone 'UTC')::date-(greatest(1,least(coalesce(days,30),90))-1) group by event,role,surface order by event,role) row),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(row) from (select id,actor_id,organization_id,action,details,created_at from private.platform_audit order by id desc limit 50) row),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function private.platform_overview(text,integer,integer) from public,anon;
grant execute on function private.platform_overview(text,integer,integer) to authenticated;
create function public.platform_overview(search_text text default '',page_number integer default 1,days integer default 30) returns jsonb language sql stable security invoker set search_path='' as $$select private.platform_overview(search_text,page_number,days);$$;
revoke all on function public.platform_overview(text,integer,integer) from public,anon;
grant execute on function public.platform_overview(text,integer,integer) to authenticated;

create function private.manage_customer(target uuid,customer_name text,customer_slug text,admin_email text,admin_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; admin_id uuid; previous text;
begin
 if private.platform_access()<>'ready' then raise exception 'Platform owner verification required' using errcode='42501'; end if;
 if customer_name is null or length(trim(customer_name)) not between 2 and 120 then raise exception 'Invalid organization name'; end if;
 if target is null then
  select id into admin_id from auth.users where lower(email)=lower(trim(admin_email)) and email_confirmed_at is not null;
  if admin_id is null then raise exception 'A verified, unassigned administrator account is required'; end if;
  result:=public.bootstrap_organization(customer_name,customer_slug,admin_name,admin_id);
  insert into private.platform_audit(actor_id,organization_id,action,details) values(auth.uid(),result,'organization_created',jsonb_build_object('name',trim(customer_name),'slug',customer_slug,'administrator_id',admin_id));
 else
  select name into previous from public.organizations where id=target for update;
  if not found then raise exception 'Organization not found'; end if;
  update public.organizations set name=trim(customer_name) where id=target; result:=target;
  if previous<>trim(customer_name) then insert into private.platform_audit(actor_id,organization_id,action,details) values(auth.uid(),result,'organization_renamed',jsonb_build_object('from',previous,'to',trim(customer_name))); end if;
 end if;
 return result;
end $$;
revoke all on function private.manage_customer(uuid,text,text,text,text) from public,anon;
grant execute on function private.manage_customer(uuid,text,text,text,text) to authenticated;
create function public.manage_customer(target uuid,customer_name text,customer_slug text default null,admin_email text default null,admin_name text default null) returns uuid language sql security invoker set search_path='' as $$select private.manage_customer(target,customer_name,customer_slug,admin_email,admin_name);$$;
revoke all on function public.manage_customer(uuid,text,text,text,text) from public,anon;
grant execute on function public.manage_customer(uuid,text,text,text,text) to authenticated;

create or replace function private.record_product_view(event_name text,org uuid,target_id uuid,event_surface text,event_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor_role public.app_role; session_key text:=auth.jwt()->>'session_id'; dedup text;
begin
  if auth.uid() is null or session_key is null or not private.has_required_assurance() then return; end if;
  if org is null and event_name='login' then select organization_id into org from public.organization_memberships where user_id=auth.uid() and status='active' order by created_at limit 1; end if;
  select role into actor_role from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active';
  if actor_role is null then return; end if;
  case event_name
    when 'login' then
      if event_surface<>'workspace' then return; end if;
      dedup:='login:'||session_key;
    when 'ticket_viewed' then
      if event_surface<>'tickets' or not exists(select 1 from public.tickets where id=target_id and organization_id=org and (actor_role<>'end_user' or requester_id=auth.uid())) then return; end if;
      dedup:='ticket_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'knowledge_article_viewed' then
      if event_surface<>'knowledge' or not exists(select 1 from public.knowledge_articles where id=target_id and organization_id=org and (actor_role<>'end_user' or status='published')) then return; end if;
      dedup:='knowledge_article_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'asset_viewed' then
      if event_surface<>'assets' or not exists(select 1 from public.assets where id=target_id and organization_id=org and (actor_role<>'end_user' or assigned_user_id=auth.uid())) then return; end if;
      dedup:='asset_viewed:'||session_key||':'||target_id::text||':'||(now() at time zone 'UTC')::date::text;
    when 'search_performed' then
      if event_surface not in ('tickets','knowledge') or event_token is null then return; end if;
      dedup:='search_performed:'||session_key||':'||event_token::text;
    else return; -- Mutation and not-yet-built asset events cannot be forged here.
  end case;
  perform private.increment_product_usage(org,event_name,event_surface,dedup,case when event_name='login' then interval '90 days' else interval '1 day' end);
exception when others then return;
end $$;

-- Employee equipment requests create the ticket and its asset association atomically.
create function private.create_equipment_ticket(org uuid,asset uuid,subject text,body text,category uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; equipment public.assets%rowtype;
begin
 if auth.uid() is null or not private.is_active_organization_member(org) or not private.has_required_assurance() then raise exception 'Access denied' using errcode='42501'; end if;
 select * into equipment from public.assets where organization_id=org and id=asset and assigned_user_id=auth.uid() for share;
 if not found then raise exception 'Equipment not assigned to you'; end if;
 if length(trim(subject)) not between 3 and 180 or length(trim(body)) not between 1 and 20000 then raise exception 'Invalid request'; end if;
 if category is not null and not exists(select 1 from public.ticket_categories where organization_id=org and id=category and is_active) then raise exception 'Invalid category'; end if;
 insert into public.tickets(organization_id,requester_id,title,description,category_id,location_id) values(org,auth.uid(),trim(subject),trim(body),category,equipment.location_id) returning id into result;
 insert into public.ticket_assets(organization_id,ticket_id,asset_id) values(org,result,asset);
 return result;
end $$;
revoke all on function private.create_equipment_ticket(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function private.create_equipment_ticket(uuid,uuid,text,text,uuid) to authenticated;
create function public.create_equipment_ticket(org uuid,asset uuid,subject text,body text,category uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.create_equipment_ticket(org,asset,subject,body,category);$$;
revoke all on function public.create_equipment_ticket(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.create_equipment_ticket(uuid,uuid,text,text,uuid) to authenticated;
