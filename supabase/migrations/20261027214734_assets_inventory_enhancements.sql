alter table public.assets add column end_of_life_on date;
alter table public.assets add constraint assets_end_of_life_date check(end_of_life_on is null or purchased_on is null or end_of_life_on>=purchased_on);
create index assets_warranty_due on public.assets(warranty_until,id) where status<>'retired' and warranty_until is not null;
create index assets_end_of_life_due on public.assets(end_of_life_on,id) where status<>'retired' and end_of_life_on is not null;

-- Historical assignments are staff-only; an employee never gains access to a
-- former assignee's equipment or profile through this ledger.
create table public.asset_assignments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, asset_id uuid not null,
 user_id uuid not null, assigned_at timestamptz, returned_at timestamptz,
 recorded_at timestamptz not null default now(),
 foreign key(organization_id,asset_id) references public.assets(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id)
);
create index asset_assignments_person on public.asset_assignments(organization_id,user_id,recorded_at desc,id);
create index asset_assignments_asset on public.asset_assignments(organization_id,asset_id);
create unique index asset_assignments_current on public.asset_assignments(organization_id,asset_id) where returned_at is null;
alter table public.asset_assignments enable row level security;
revoke all on public.asset_assignments from anon,authenticated;
grant select on public.asset_assignments to authenticated;
create policy asset_assignments_staff on public.asset_assignments for select to authenticated using(private.can_work_tickets(organization_id));
create policy asset_assignments_assurance on public.asset_assignments as restrictive to authenticated using((select private.has_required_assurance()));
insert into public.asset_assignments(organization_id,asset_id,user_id,assigned_at)
 select organization_id,id,assigned_user_id,null from public.assets where assigned_user_id is not null;
create function private.track_asset_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.assigned_user_id is not distinct from new.assigned_user_id then return new; end if;
 if tg_op='UPDATE' and old.assigned_user_id is not null then
  update public.asset_assignments set returned_at=now() where organization_id=old.organization_id and asset_id=old.id and returned_at is null;
 end if;
 if new.assigned_user_id is not null then
  insert into public.asset_assignments(organization_id,asset_id,user_id,assigned_at) values(new.organization_id,new.id,new.assigned_user_id,now());
 end if;
 return new;
end $$;
revoke all on function private.track_asset_assignment() from public,anon,authenticated;
create trigger track_asset_assignment after insert or update of assigned_user_id on public.assets for each row execute function private.track_asset_assignment();

-- Lock and validate the complete preview before any write. RLS, existing asset
-- validation and inventory guards remain authoritative on every row.
create function public.import_asset_updates(org uuid,records jsonb,expected jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare r jsonb; a public.assets; total integer:=0;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then raise exception 'Asset import access denied' using errcode='42501'; end if;
 if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) not between 1 and 500 or octet_length(records::text)>700000 or jsonb_typeof(expected) is distinct from 'object' then raise exception 'Invalid asset batch'; end if;
 if exists(select 1 from jsonb_array_elements(records) entries(value) group by upper(trim(entries.value->>'tag')) having count(*)>1) then raise exception 'Repeated asset tag'; end if;
 for r in select value from jsonb_array_elements(records) order by upper(trim(value->>'tag')) loop
  select * into a from public.assets where organization_id=org and tag=upper(trim(r->>'tag')) for update;
  if found then
   if not expected ? a.tag or (expected->>a.tag)::bigint is distinct from a.revision then raise exception 'Asset changed since preview. Preview the file again.' using errcode='40001'; end if;
  elsif expected ? upper(trim(r->>'tag')) then raise exception 'Asset changed since preview. Preview the file again.' using errcode='40001'; end if;
 end loop;
 for r in select value from jsonb_array_elements(records) order by upper(trim(value->>'tag')) loop
  insert into public.assets(organization_id,tag,name,kind,status,serial_number,model,assigned_user_id,location_id,purchased_on,warranty_until,end_of_life_on)
  values(org,upper(trim(r->>'tag')),r->>'name',r->>'kind',r->>'status',nullif(r->>'serial_number',''),nullif(r->>'model',''),nullif(r->>'assigned_user_id','')::uuid,nullif(r->>'location_id','')::uuid,nullif(r->>'purchased_on','')::date,nullif(r->>'warranty_until','')::date,nullif(r->>'end_of_life_on','')::date)
  on conflict(organization_id,tag) do update set name=excluded.name,kind=excluded.kind,status=excluded.status,serial_number=excluded.serial_number,model=excluded.model,assigned_user_id=excluded.assigned_user_id,location_id=excluded.location_id,purchased_on=excluded.purchased_on,warranty_until=excluded.warranty_until,end_of_life_on=excluded.end_of_life_on
  -- A new tag created after the lock pass must conflict, never be overwritten.
  where expected ? excluded.tag;
  if not found then raise exception 'Asset changed since preview. Preview the file again.' using errcode='40001'; end if;
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.import_asset_updates(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.import_asset_updates(uuid,jsonb,jsonb) to authenticated;

alter table public.inventory_items add column reorder_threshold integer check(reorder_threshold>=0), add column low_stock_episode bigint not null default 0;
alter table public.notifications add column asset_id uuid,add column inventory_item_id uuid;
alter table public.notifications add constraint notifications_asset_fk foreign key(organization_id,asset_id) references public.assets(organization_id,id) on delete cascade;
alter table public.notifications add constraint notifications_inventory_fk foreign key(organization_id,inventory_item_id) references public.inventory_items(organization_id,id) on delete cascade;
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check check(num_nonnulls(ticket_id,conversation_id,service_announcement_id,asset_id,inventory_item_id)=1);
create index notifications_asset_idx on public.notifications(organization_id,asset_id) where asset_id is not null;
create index notifications_inventory_idx on public.notifications(organization_id,inventory_item_id) where inventory_item_id is not null;
drop policy notifications_recipient on public.notifications;
create policy notifications_recipient on public.notifications for select to authenticated using (
 recipient_id=(select auth.uid()) and private.is_active_organization_member(organization_id)
 and (not staff_only or private.can_work_tickets(organization_id))
 and (case when asset_id is not null then private.can_work_tickets(organization_id)
 when inventory_item_id is not null then private.inventory_manager(organization_id)
 when service_announcement_id is not null then exists(select 1 from public.service_announcements a where a.id=notifications.service_announcement_id and a.organization_id=notifications.organization_id)
 when incident_bulletin_id is not null then exists(select 1 from public.incident_bulletin_recipients r where r.organization_id=notifications.organization_id and r.bulletin_id=notifications.incident_bulletin_id and r.user_id=(select auth.uid()))
 else (ticket_id is not null and private.can_view_ticket(organization_id,ticket_id)) or (conversation_id is not null and private.can_view_chat(organization_id,conversation_id)) end)
);
create function private.enqueue_equipment_alert(org uuid,recipient uuid,asset uuid,item uuid,heading text,event text) returns void
language plpgsql security definer set search_path='' as $$
declare notice uuid;
begin
 insert into public.notifications(organization_id,recipient_id,asset_id,inventory_item_id,kind,title,staff_only,event_key)
 values(org,recipient,asset,item,case when item is null then 'asset_lifecycle'::public.notification_kind else 'inventory_low_stock'::public.notification_kind end,heading,item is null,event)
 on conflict(recipient_id,event_key) do nothing returning id into notice;
 if notice is not null then
  insert into private.notification_email_outbox(notification_id,coalesce_key,email_reason_version) values(notice,notice::text,1);
 end if;
end $$;
revoke all on function private.enqueue_equipment_alert(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
create function private.alert_inventory_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if tg_when='BEFORE' then
  if new.reorder_threshold is not null and new.stock-new.reserved<=new.reorder_threshold
    and (old.reorder_threshold is null or old.stock-old.reserved>old.reorder_threshold or old.reorder_threshold is distinct from new.reorder_threshold)
  then new.low_stock_episode:=old.low_stock_episode+1; end if;
  return new;
 end if;
 if new.reorder_threshold is not null and new.stock-new.reserved<=new.reorder_threshold then
  for recipient in select m.user_id from public.inventory_managers g join public.organization_memberships m using(organization_id,user_id) where g.organization_id=new.organization_id and m.status='active' loop
   perform private.enqueue_equipment_alert(new.organization_id,recipient,null,new.id,
    'Low stock: '||new.name||' · '||(new.stock-new.reserved)||' available (reorder at '||new.reorder_threshold||')',
    'stock:'||new.id||':'||new.low_stock_episode);
  end loop;
 else
  update private.notification_email_outbox q set status='skipped',last_error='Stock recovered or alert disabled'
   from public.notifications n where q.notification_id=n.id and n.inventory_item_id=new.id and q.status='pending';
 end if;
 return new;
end $$;
revoke all on function private.alert_inventory_stock() from public,anon,authenticated;
create trigger inventory_stock_episode before update of stock,reserved,reorder_threshold on public.inventory_items for each row execute function private.alert_inventory_stock();
create trigger inventory_stock_alert after update of stock,reserved,reorder_threshold on public.inventory_items for each row execute function private.alert_inventory_stock();
create function private.set_reorder_threshold(org uuid,item uuid,threshold integer,expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare previous integer; actor_name text; item_name text;
begin
 if auth.uid() is null or not coalesce(private.inventory_manager(org),false) or not private.has_required_assurance() then raise exception 'Inventory manager permission required' using errcode='42501'; end if;
 if threshold<0 then raise exception 'Enter a nonnegative reorder threshold'; end if;
 select reorder_threshold,name into previous,item_name from public.inventory_items where organization_id=org and id=item for update;
 if not found then raise exception 'Inventory item unavailable' using errcode='42501'; end if;
 if previous is distinct from expected then raise exception 'Threshold changed. Reload before saving.' using errcode='40001'; end if;
 if previous is not distinct from threshold then return; end if;
 update public.inventory_items set reorder_threshold=threshold where organization_id=org and id=item;
 select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),coalesce(actor_name,'Member'),'inventory_items',item,item_name,'updated',jsonb_build_array(jsonb_build_object('field','reorder_threshold','from',previous,'to',threshold)));
end $$;
revoke all on function private.set_reorder_threshold(uuid,uuid,integer,integer) from public,anon;
grant execute on function private.set_reorder_threshold(uuid,uuid,integer,integer) to authenticated;
create function public.set_inventory_reorder_threshold(org uuid,item uuid,threshold integer,expected integer) returns void
language sql security invoker set search_path='' as $$select private.set_reorder_threshold(org,item,threshold,expected);$$;
revoke all on function public.set_inventory_reorder_threshold(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.set_inventory_reorder_threshold(uuid,uuid,integer,integer) to authenticated;

create table private.asset_lifecycle_scans(asset_id uuid primary key references public.assets(id) on delete cascade,checked_at timestamptz not null);
revoke all on private.asset_lifecycle_scans from public,anon,authenticated;
create function public.process_equipment_reminders(batch_size integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare a record; deadline date; date_kind text; stage text; recipient uuid; total integer:=0; today date;
begin
 for a in select x.*,o.timezone from public.assets x join public.organizations o on o.id=x.organization_id
  left join private.asset_lifecycle_scans s on s.asset_id=x.id
  where x.status<>'retired' and (x.warranty_until<=(now() at time zone o.timezone)::date+30 or x.end_of_life_on<=(now() at time zone o.timezone)::date+30)
  order by s.checked_at nulls first,x.id limit greatest(1,least(coalesce(batch_size,100),500)) for update of x skip locked loop
  insert into private.asset_lifecycle_scans(asset_id,checked_at) values(a.id,now()) on conflict(asset_id) do update set checked_at=excluded.checked_at;
  today:=(now() at time zone a.timezone)::date;
  foreach date_kind in array array['warranty','end_of_life'] loop
   deadline:=case when date_kind='warranty' then a.warranty_until else a.end_of_life_on end;
   if deadline is null or deadline>today+30 then continue; end if;
   stage:=case when deadline<=today then 'due' else 'soon' end;
   for recipient in select user_id from public.organization_memberships where organization_id=a.organization_id and status='active' and role in ('administrator','technician') loop
    perform private.enqueue_equipment_alert(a.organization_id,recipient,a.id,null,
     a.tag||' · '||case when date_kind='warranty' then 'Warranty' else 'End of life' end||case when stage='due' then ' reached: ' else ' due: ' end||deadline,
     'asset:'||a.id||':'||date_kind||':'||deadline||':'||stage);
   end loop;
  end loop;
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.process_equipment_reminders(integer) from public,anon,authenticated;
grant execute on function public.process_equipment_reminders(integer) to service_role;

create or replace function private.audit_asset() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; previous jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end; delta jsonb:='[]'; k text; actor_name text; label text; fields text[];
begin
 select p.display_name into actor_name from public.profiles p where p.organization_id=(r->>'organization_id')::uuid and p.user_id=auth.uid();
 if tg_table_name='assets' then label:=(r->>'tag')||' · '||(r->>'name'); fields:=array['tag','name','kind','status','serial_number','model','assigned_user_id','location_id','purchased_on','warranty_until','end_of_life_on'];
 else select a.tag||' · Ticket #'||t.ticket_number into label from public.assets a join public.tickets t on t.organization_id=a.organization_id where a.id=(r->>'asset_id')::uuid and t.id=(r->>'ticket_id')::uuid; fields:=array['asset_id','ticket_id']; end if;
 foreach k in array fields loop
  if tg_op<>'UPDATE' or previous->k is distinct from r->k then delta:=delta||jsonb_build_array(jsonb_build_object('field',k,'from',case when tg_op='INSERT' then null else previous->k end,'to',case when tg_op='DELETE' then null else r->k end)); end if;
 end loop;
 if jsonb_array_length(delta)>0 then
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes) values((r->>'organization_id')::uuid,auth.uid(),coalesce(actor_name,'System'),tg_table_name,coalesce(r->>'id',r->>'asset_id')::uuid,label,case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.claim_notification_emails(batch_size integer default 10)
returns table(notification_id uuid,lease_token uuid,recipient_email text,title text,ticket_id uuid,conversation_id uuid,incident_bulletin_id uuid,approved_body text,next_update_at timestamptz,email_kind text,reply_author text,reply_preview text,reply_created_at timestamptz,ticket_status public.ticket_status,ticket_priority public.ticket_priority,previous_status public.ticket_status,status_changed_by text,ticket_owner text,event_created_at timestamptz,reopen_reason text,service_announcement_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
 update private.notification_email_outbox q set status='skipped',last_error='Read, expired, or recipient no longer authorized'
 from public.notifications n where q.notification_id=n.id and q.status in ('pending','sending')
 and (q.status='pending' or q.lease_until<now()) and (
   (n.service_announcement_id is null and n.read_at is not null and n.kind not in ('ticket_created','ticket_assigned','ticket_reassigned')) or n.created_at<now()-interval '24 hours'
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
