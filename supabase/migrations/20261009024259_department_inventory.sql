-- Additive inventory: legacy assets and service history remain untouched.
create table public.inventory_managers (
 organization_id uuid not null, user_id uuid not null,
 primary key(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id)
);
create table public.inventory_requesters (
 organization_id uuid not null, user_id uuid not null, department_id uuid not null,
 primary key(organization_id,user_id,department_id),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,department_id) references public.departments(organization_id,id)
);
create index inventory_requesters_department on public.inventory_requesters(organization_id,department_id);
create function private.inventory_manager(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_active_organization_member(org) and private.has_required_assurance()
 and exists(select 1 from public.inventory_managers where organization_id=org and user_id=auth.uid());
$$;
create function private.inventory_requester(org uuid,department uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_active_organization_member(org) and private.has_required_assurance()
 and exists(select 1 from public.inventory_requesters where organization_id=org and user_id=auth.uid() and department_id=department);
$$;
create table public.inventory_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 2 and 160), kind text not null check(kind in ('equipment','consumable')),
 department_id uuid not null, location_id uuid not null,
 department_name text not null, location_name text not null,
 stock integer not null default 0 check(stock>=0), reserved integer not null default 0 check(reserved>=0 and reserved<=stock),
 created_at timestamptz not null default now(), unique(organization_id,id),
 foreign key(organization_id,department_id) references public.departments(organization_id,id),
 foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create index inventory_items_department on public.inventory_items(organization_id,department_id,name,id);
create index inventory_items_location on public.inventory_items(organization_id,location_id);
create table public.inventory_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, ticket_id uuid not null unique,
 item_id uuid not null, requester_id uuid not null, department_id uuid not null,
 quantity integer not null check(quantity>0), state text not null default 'pending' check(state in ('pending','needs_information','approved','declined','cancelled','issued')),
 recipient_id uuid, destination text not null check(length(trim(destination)) between 1 and 240), printer_id uuid,
 context jsonb not null, reason text not null default '', decision_reason text, issued_by uuid, issued_at timestamptz,
 created_at timestamptz not null default now(), unique(organization_id,id),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id),
 foreign key(organization_id,item_id) references public.inventory_items(organization_id,id),
 foreign key(organization_id,requester_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,recipient_id) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,issued_by) references public.organization_memberships(organization_id,user_id),
 foreign key(organization_id,department_id) references public.departments(organization_id,id),
 foreign key(organization_id,printer_id) references public.assets(organization_id,id)
);
create index inventory_requests_item on public.inventory_requests(organization_id,item_id,state);
create index inventory_requests_requester on public.inventory_requests(organization_id,requester_id,created_at desc,id);
create index inventory_requests_recipient on public.inventory_requests(organization_id,recipient_id);
create index inventory_requests_department on public.inventory_requests(organization_id,department_id);
create index inventory_requests_printer on public.inventory_requests(organization_id,printer_id);
create index inventory_requests_issuer on public.inventory_requests(organization_id,issued_by);
-- Each equipment unit references the existing asset, never a duplicate asset record.
create table public.inventory_equipment (
 organization_id uuid not null, asset_id uuid not null, item_id uuid not null, request_id uuid,
 state text not null default 'stored' check(state in ('stored','reserved','issued','removed')),
 asset_context jsonb not null,
 primary key(organization_id,asset_id),
 foreign key(organization_id,asset_id) references public.assets(organization_id,id),
 foreign key(organization_id,item_id) references public.inventory_items(organization_id,id),
 foreign key(organization_id,request_id) references public.inventory_requests(organization_id,id),
 check((state in ('reserved','issued'))=(request_id is not null))
);
create index inventory_equipment_item on public.inventory_equipment(organization_id,item_id,state,asset_id);
create index inventory_equipment_request on public.inventory_equipment(organization_id,request_id);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, item_id uuid not null, request_id uuid,
 kind text not null check(kind in ('received','corrected','reserved','released','issued')),
 quantity integer not null check(quantity<>0), actor_id uuid, actor_name text not null,
 note text not null default '', context jsonb not null, created_at timestamptz not null default now(),
 foreign key(organization_id,item_id) references public.inventory_items(organization_id,id),
 foreign key(organization_id,request_id) references public.inventory_requests(organization_id,id),
 foreign key(organization_id,actor_id) references public.organization_memberships(organization_id,user_id)
);
create index inventory_movements_item on public.inventory_movements(organization_id,item_id,created_at desc,id);
create index inventory_movements_request on public.inventory_movements(organization_id,request_id);
create index inventory_movements_actor on public.inventory_movements(organization_id,actor_id);
create trigger inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function private.protect_audit_event();
-- Opaque retry keys are scoped to actor and organization; mismatched payloads fail.
create table private.inventory_commands (
 organization_id uuid not null, actor_id uuid not null, token uuid not null, payload jsonb not null, result uuid,
 primary key(organization_id,actor_id,token)
);
alter table private.inventory_commands enable row level security;
revoke all on private.inventory_commands from public,anon,authenticated;

-- No direct writes to inventory, including by administrators. Checked commands
-- provide atomic stock changes, live permission checks and durable audit records.
do $$ declare tab text; begin
 foreach tab in array array['inventory_managers','inventory_requesters','inventory_items','inventory_requests','inventory_equipment','inventory_movements'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from public,anon,authenticated',tab);
 execute format('grant select on public.%I to authenticated',tab);
 execute format('create policy inventory_assurance on public.%I as restrictive for select to authenticated using(private.is_active_organization_member(organization_id) and private.has_required_assurance())',tab);
 end loop;
end $$;
create policy inventory_managers_read on public.inventory_managers for select to authenticated using(user_id=(select auth.uid()) or private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy inventory_requesters_read on public.inventory_requesters for select to authenticated using(user_id=(select auth.uid()) or private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy inventory_items_read on public.inventory_items for select to authenticated using(private.inventory_manager(organization_id) or private.inventory_requester(organization_id,department_id));
create policy inventory_requests_read on public.inventory_requests for select to authenticated using(private.inventory_manager(organization_id) or requester_id=(select auth.uid()) or private.can_work_tickets(organization_id));
create policy inventory_equipment_read on public.inventory_equipment for select to authenticated using(private.inventory_manager(organization_id) or private.can_work_tickets(organization_id));
create policy inventory_movements_read on public.inventory_movements for select to authenticated using(private.inventory_manager(organization_id));

alter table public.tickets add column request_kind text not null default 'support' check(request_kind in ('support','inventory'));
create index tickets_inventory_queue on public.tickets(organization_id,request_kind,updated_at desc,id);
create function private.guard_ticket_request_kind() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.request_kind<>'support' and current_user not in ('postgres','supabase_admin')) or (tg_op='UPDATE' and new.request_kind<>old.request_kind) then raise exception 'Ticket request type is managed by Inventory'; end if;
 return new;
end $$;
create trigger guard_ticket_request_kind before insert or update on public.tickets for each row execute function private.guard_ticket_request_kind();
-- Inventory managers can read linked tickets/conversations, not unrelated support.
alter policy "Members can view permitted tickets" on public.tickets using(private.is_active_organization_member(organization_id) and (requester_id=(select auth.uid()) or private.can_work_tickets(organization_id) or (private.inventory_manager(organization_id) and exists(select 1 from public.inventory_requests r where r.ticket_id=tickets.id))));
create or replace function private.can_view_ticket(target_organization_id uuid,target_ticket_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active_organization_member(target_organization_id) and exists(select 1 from public.tickets t where t.organization_id=target_organization_id and t.id=target_ticket_id and
 (t.requester_id=auth.uid() or private.can_work_tickets(target_organization_id) or (private.inventory_manager(target_organization_id) and exists(select 1 from public.inventory_requests r where r.ticket_id=t.id))));
$$;

create function private.inventory_command(org uuid,command text,token uuid,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
<<mutation>>
declare actor uuid:=auth.uid(); result uuid; previous private.inventory_commands%rowtype;
 item public.inventory_items%rowtype; req public.inventory_requests%rowtype; unit public.assets%rowtype;
 target uuid:=nullif(payload->>'id','')::uuid; dept uuid; loc uuid; recipient uuid; printer uuid;
 qty integer; asset_ids uuid[]; chosen uuid; actor_label text; snapshot jsonb; message text; manager boolean;
begin
 if actor is null or not private.is_active_organization_member(org) or not private.has_required_assurance() then raise exception 'Inventory access denied' using errcode='42501'; end if;
 manager:=private.inventory_manager(org);
 -- Check current authority before looking up a retry, so revocation takes effect.
 if command='permissions' then
  if not private.has_organization_role(org,array['administrator']::public.app_role[]) then raise exception 'Only administrators can assign inventory permissions' using errcode='42501'; end if;
 elsif command='request' then
  select * into item from public.inventory_items where organization_id=org and id=target;
  if not found or not private.inventory_requester(org,item.department_id) then raise exception 'Request permission required for this department' using errcode='42501'; end if;
 elsif command='cancel' then
  select * into req from public.inventory_requests where organization_id=org and id=target;
  if not found or not (manager or (req.requester_id=actor and private.inventory_requester(org,req.department_id))) then raise exception 'Inventory access denied' using errcode='42501'; end if;
 elsif not manager then raise exception 'Inventory manager permission required' using errcode='42501'; end if;
 if token is null or payload is null then raise exception 'Retry key and input required'; end if;
 insert into private.inventory_commands values(org,actor,token,jsonb_build_object('command',command,'input',payload),null) on conflict do nothing;
 select * into previous from private.inventory_commands where organization_id=org and actor_id=actor and inventory_commands.token=inventory_command.token for update;
 if previous.payload<>jsonb_build_object('command',command,'input',payload) then raise exception 'Retry key already used for different input'; end if;
 if previous.result is not null then return previous.result; end if;
 select coalesce(display_name,'Member') into actor_label from public.profiles where organization_id=org and user_id=actor;
 actor_label:=coalesce(actor_label,'Member');
 if command='permissions' then
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=target) then raise exception 'Person unavailable'; end if;
  -- Replacing the grants is serialized per person, allowing multiple departments.
  perform 1 from public.organization_memberships where organization_id=org and user_id=target for update;
  delete from public.inventory_requesters where organization_id=org and user_id=target;
  for dept in select value::uuid from jsonb_array_elements_text(coalesce(payload->'departments','[]')) loop
   if not exists(select 1 from public.departments where organization_id=org and id=dept and is_active) then raise exception 'Choose an active department in this organization'; end if;
   insert into public.inventory_requesters values(org,target,dept) on conflict do nothing;
  end loop;
  delete from public.inventory_managers where organization_id=org and user_id=target;
  if coalesce((payload->>'manager')::boolean,false) then insert into public.inventory_managers values(org,target); end if;
  result:=target;
 elsif command='create' then
  dept:=(payload->>'department')::uuid; loc:=(payload->>'location')::uuid;
  if not exists(select 1 from public.departments where organization_id=org and id=dept and is_active) or not exists(select 1 from public.locations where organization_id=org and id=loc and is_active) then raise exception 'Choose an active department and storage location'; end if;
  insert into public.inventory_items(organization_id,name,kind,department_id,location_id,department_name,location_name)
  select org,trim(payload->>'name'),payload->>'kind',dept,loc,d.name,l.name from public.departments d,public.locations l where d.id=dept and l.id=loc returning id into result;
 elsif command='request' then
  qty:=(payload->>'quantity')::integer; recipient:=nullif(payload->>'recipient','')::uuid; printer:=nullif(payload->>'printer','')::uuid;
  if qty is null or qty<=0 or length(trim(coalesce(payload->>'destination',''))) not between 1 and 240 or length(coalesce(payload->>'reason',''))>20000 then raise exception 'Choose a positive whole quantity and recipient or destination'; end if;
  if not exists(select 1 from public.departments where organization_id=org and id=item.department_id and is_active) then raise exception 'Department is inactive'; end if;
  if recipient is not null and not exists(select 1 from public.organization_memberships where organization_id=org and user_id=recipient and status='active') then raise exception 'Recipient unavailable'; end if;
  if item.kind='equipment' and qty>100 then raise exception 'Choose at most 100 equipment units per request'; end if;
  if printer is not null and (item.kind<>'consumable' or not exists(select 1 from public.assets where organization_id=org and id=printer and kind='printer' and status<>'retired')) then raise exception 'Choose an active printer in this organization'; end if;
  snapshot:=jsonb_build_object('item',item.name,'kind',item.kind,'department',item.department_name,'storage',item.location_name,'requester',actor_label,'recipient',(select display_name from public.profiles where organization_id=org and user_id=recipient),'destination',trim(payload->>'destination'),'printer',(select tag||' · '||name from public.assets where organization_id=org and id=printer));
  insert into public.tickets(organization_id,requester_id,request_kind,title,description) values(org,actor,'inventory','Inventory: '||item.name,'Quantity: '||qty||E'\nDestination: '||trim(payload->>'destination')||E'\n'||coalesce(payload->>'reason','')) returning id into chosen;
  insert into public.inventory_requests(organization_id,ticket_id,item_id,requester_id,department_id,quantity,recipient_id,destination,printer_id,context,reason) values(org,chosen,item.id,actor,item.department_id,qty,recipient,trim(payload->>'destination'),printer,snapshot,coalesce(payload->>'reason','')) returning id into result;
  if printer is not null then insert into public.ticket_assets values(org,chosen,printer,now()) on conflict do nothing; end if;
  for recipient in select user_id from public.inventory_managers where organization_id=org loop
   perform private.enqueue_notification(org,recipient,actor,chosen,null,'ticket_response','New inventory request: '||item.name,false,'inventory:submitted:'||result);
  end loop;
 else
  if command in ('receive','correct') then
   select * into item from public.inventory_items where organization_id=org and id=target for update;
  else
   -- Ticket -> request -> stock is the common lock order, also used by closing.
   select ticket_id into chosen from public.inventory_requests where organization_id=org and id=target;
   perform 1 from public.tickets where organization_id=org and id=chosen for update;
   select * into req from public.inventory_requests where organization_id=org and id=target for update;
   select * into item from public.inventory_items where organization_id=org and id=req.item_id for update;
  end if;
  if item.id is null then raise exception 'Inventory item unavailable'; end if;
  snapshot:=coalesce(req.context,jsonb_build_object('item',item.name,'department',item.department_name,'storage',item.location_name));
  message:=trim(coalesce(payload->>'note',''));
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into asset_ids from jsonb_array_elements_text(coalesce(payload->'assets','[]'));
  if cardinality(asset_ids)<>(select count(distinct x) from unnest(asset_ids) x) then raise exception 'Choose each asset once'; end if;
  if command in ('receive','correct') then
   qty:=(payload->>'quantity')::integer;
   if qty is null or qty=0 or (command='receive' and qty<0) or (command='correct' and message='') then raise exception 'Use a whole quantity and a reason for corrections'; end if;
   if item.stock+qty<item.reserved then raise exception 'Correction would reduce stock below reservations'; end if;
   if item.kind='equipment' then
    if cardinality(asset_ids)<>abs(qty) then raise exception 'Select exactly one asset per equipment unit'; end if;
    foreach chosen in array asset_ids loop
     select * into unit from public.assets where organization_id=org and id=chosen for update;
     if not found or unit.status<>'available' or unit.assigned_user_id is not null then raise exception 'Equipment must be available and unassigned'; end if;
     if qty>0 then
      insert into public.inventory_equipment(organization_id,asset_id,item_id,asset_context) values(org,chosen,item.id,jsonb_build_object('tag',unit.tag,'name',unit.name,'serial',unit.serial_number))
      on conflict(organization_id,asset_id) do update set state='stored' where inventory_equipment.state='removed' and inventory_equipment.item_id=item.id;
      if not found then raise exception 'Equipment already received or issued'; end if;
      update public.assets set location_id=item.location_id where organization_id=org and id=chosen;
     else
      update public.inventory_equipment set state='removed' where organization_id=org and asset_id=chosen and item_id=item.id and state='stored';
      if not found then raise exception 'Only unreserved stored equipment can be removed'; end if;
     end if;
    end loop;
   end if;
   update public.inventory_items set stock=stock+qty where id=item.id;
   insert into public.inventory_movements(organization_id,item_id,kind,quantity,actor_id,actor_name,note,context) values(org,item.id,case command when 'receive' then 'received' else 'corrected' end,qty,actor,actor_label,message,snapshot||jsonb_build_object('assets',asset_ids));
   result:=item.id;
  elsif command='approve' then
   if req.state='approved' then result:=req.id;
   elsif req.state not in ('pending','needs_information') then raise exception 'This request cannot be approved';
   else
    if exists(select 1 from public.tickets where id=req.ticket_id and status in ('closed','resolved')) then raise exception 'Reopen the conversation before reviewing a pending request'; end if;
    if item.stock-item.reserved<req.quantity then raise exception 'Insufficient available stock. Refresh and review the quantity.'; end if;
    if item.kind='equipment' then
     if cardinality(asset_ids)<>req.quantity then raise exception 'Choose the specific equipment for the full quantity'; end if;
     foreach chosen in array asset_ids loop
      perform 1 from public.assets where organization_id=org and id=chosen and status='available' and assigned_user_id is null for update;
      if not found then raise exception 'Equipment no longer available'; end if;
      update public.inventory_equipment set state='reserved',request_id=req.id where organization_id=org and asset_id=chosen and item_id=item.id and state='stored';
      if not found then raise exception 'Equipment already reserved or allocated elsewhere'; end if;
      insert into public.ticket_assets values(org,req.ticket_id,chosen,now()) on conflict do nothing;
     end loop;
    end if;
    update public.inventory_items set reserved=reserved+req.quantity where id=item.id;
    update public.inventory_requests set state='approved' where id=req.id;
    insert into public.inventory_movements(organization_id,item_id,request_id,kind,quantity,actor_id,actor_name,context) values(org,item.id,req.id,'reserved',req.quantity,actor,actor_label,snapshot||jsonb_build_object('assets',asset_ids));
    result:=req.id;
   end if;
  elsif command='issue' then
   if req.state='issued' then result:=req.id;
   elsif req.state<>'approved' then raise exception 'Approve and reserve stock before issuance';
   else
    if payload->>'destination' is distinct from req.destination or nullif(payload->>'recipient','')::uuid is distinct from req.recipient_id then raise exception 'Confirm the approved recipient and destination without substitution'; end if;
    if req.recipient_id is not null and not exists(select 1 from public.organization_memberships where organization_id=org and user_id=req.recipient_id and status='active') then raise exception 'Recipient is inactive. Cancel and submit a new request.'; end if;
    if item.kind='equipment' then
     if asset_ids is distinct from (select coalesce(array_agg(asset_id order by asset_id),'{}'::uuid[]) from public.inventory_equipment where organization_id=org and request_id=req.id and state='reserved') then raise exception 'Confirm the exact reserved equipment'; end if;
     update public.inventory_equipment set state='issued' where organization_id=org and request_id=req.id and state='reserved';
     update public.assets set assigned_user_id=req.recipient_id,status='in_use',location_id=case when req.recipient_id is null then null else (select location_id from public.profiles where organization_id=org and user_id=req.recipient_id) end where organization_id=org and id=any(asset_ids);
    end if;
    update public.inventory_items set stock=stock-req.quantity,reserved=reserved-req.quantity where id=item.id;
    update public.inventory_requests set state='issued',issued_by=actor,issued_at=now() where id=req.id;
    insert into public.inventory_movements(organization_id,item_id,request_id,kind,quantity,actor_id,actor_name,note,context) values(org,item.id,req.id,'issued',req.quantity,actor,actor_label,message,snapshot||jsonb_build_object('assets',asset_ids));
    result:=req.id;
   end if;
  elsif command in ('decline','cancel','information') then
   if req.state=(case command when 'decline' then 'declined' when 'cancel' then 'cancelled' else 'needs_information' end) then result:=req.id;
   elsif req.state in ('issued','cancelled','declined') then raise exception 'This fulfillment is final. Submit a new request for more stock.';
   else
    if command in ('decline','information') and message='' then raise exception 'A reason or question is required'; end if;
    if req.state='approved' then
     update public.inventory_items set reserved=reserved-req.quantity where id=item.id;
     update public.inventory_equipment set state='stored',request_id=null where organization_id=org and request_id=req.id and state='reserved';
     insert into public.inventory_movements(organization_id,item_id,request_id,kind,quantity,actor_id,actor_name,note,context) values(org,item.id,req.id,'released',req.quantity,actor,actor_label,message,snapshot);
    end if;
    update public.inventory_requests set state=case command when 'decline' then 'declined' when 'cancel' then 'cancelled' else 'needs_information' end,decision_reason=message where id=req.id;
    result:=req.id;
   end if;
  else raise exception 'Unknown inventory command'; end if;
  if req.id is not null and req.state is distinct from (select state from public.inventory_requests where id=req.id) then
   message:='Inventory '||(select state from public.inventory_requests where id=req.id)||case when message='' then '' else ': '||message end;
   insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values(org,req.ticket_id,actor,'reply',message);
   insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details) values(org,req.ticket_id,actor,'inventory_'||command,snapshot);
   perform private.enqueue_notification(org,req.requester_id,actor,req.ticket_id,null,'ticket_response',message,false,'inventory:'||token);
   for recipient in select user_id from public.inventory_managers where organization_id=org loop
    perform private.enqueue_notification(org,recipient,actor,req.ticket_id,null,'ticket_response',message,false,'inventory:'||token);
   end loop;
  end if;
 end if;
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes) values(org,actor,actor_label,'inventory',result,coalesce(item.name,'Inventory permissions'),'updated',jsonb_build_array(jsonb_build_object('field','inventory_action','from',null,'to',command),jsonb_build_object('field','inventory_details','from',null,'to',jsonb_build_object('quantity',qty,'note',payload->>'note','manager',payload->'manager','departments',(select jsonb_agg(d.name order by d.name) from public.inventory_requesters g join public.departments d on d.id=g.department_id where g.organization_id=org and g.user_id=target and command='permissions'),'department',item.department_name,'location',item.location_name,'destination',req.destination))));
 update private.inventory_commands set result=mutation.result where organization_id=org and actor_id=actor and inventory_commands.token=inventory_command.token;
 return result;
end $$;
create function public.inventory_command(org uuid,command text,token uuid,payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.inventory_command(org,command,token,payload); $$;

-- Stored/reserved equipment cannot be edited out from under inventory via the
-- existing asset editor or import. Issued assets keep their normal lifecycle.
create function private.guard_inventory_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') and exists(select 1 from public.inventory_equipment e where e.organization_id=old.organization_id and e.asset_id=old.id and e.state in ('stored','reserved')) and
 (new.status is distinct from old.status or new.assigned_user_id is distinct from old.assigned_user_id or new.location_id is distinct from old.location_id) then raise exception 'Manage stored equipment through Inventory'; end if;
 return new;
end $$;
-- Definer is deliberately avoided here, but RLS must not hide the guard's row.
-- Ticket workers also read equipment links through inventory_equipment_read, so the invoker asset guard can enforce stored/reserved restrictions.
create trigger guard_inventory_asset before update on public.assets for each row execute function private.guard_inventory_asset();

-- Resolve/close cancels unfinished fulfillment; reopen never recreates a hold.
create function private.inventory_ticket_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.inventory_requests%rowtype; i public.inventory_items%rowtype;
begin
 if new.status is distinct from old.status and new.status in ('resolved','closed') then
  select * into r from public.inventory_requests where organization_id=new.organization_id and ticket_id=new.id for update;
  if r.id is not null and r.state in ('pending','needs_information','approved') then
   select * into i from public.inventory_items where id=r.item_id for update;
   if r.state='approved' then
    update public.inventory_items set reserved=reserved-r.quantity where id=i.id;
    update public.inventory_equipment set state='stored',request_id=null where organization_id=r.organization_id and request_id=r.id and state='reserved';
    insert into public.inventory_movements(organization_id,item_id,request_id,kind,quantity,actor_id,actor_name,note,context) values(r.organization_id,i.id,r.id,'released',r.quantity,auth.uid(),coalesce((select display_name from public.profiles where organization_id=r.organization_id and user_id=auth.uid()),'System'),'Ticket closed',r.context);
   end if;
   update public.inventory_requests set state='cancelled',decision_reason='Ticket closed before issuance' where id=r.id;
   insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details) values(r.organization_id,r.ticket_id,auth.uid(),'inventory_cancelled',jsonb_build_object('reason','Ticket closed before issuance'));
   perform private.enqueue_notification(r.organization_id,r.requester_id,auth.uid(),r.ticket_id,null,'ticket_response','Inventory request cancelled; stock released',false,'inventory:closed:'||r.id);
  end if;
 end if;
 return new;
end $$;
create trigger inventory_ticket_lifecycle after update on public.tickets for each row execute function private.inventory_ticket_lifecycle();

revoke all on function private.inventory_manager(uuid),private.inventory_requester(uuid,uuid),private.inventory_command(uuid,text,uuid,jsonb),public.inventory_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.inventory_manager(uuid),private.inventory_requester(uuid,uuid),private.inventory_command(uuid,text,uuid,jsonb),public.inventory_command(uuid,text,uuid,jsonb) to authenticated;
revoke all on function private.guard_inventory_asset(),private.inventory_ticket_lifecycle() from public,anon,authenticated;

-- Permission-scoped reference pages for inventory forms. These reveal only
-- organization identities/assets, never support notes or private profile fields.
create function private.inventory_choices(org uuid,resource text,query text,after_label text,after_id uuid,selected uuid,parent uuid,active_only boolean)
returns table(id uuid,label text,active boolean,parent_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_active_organization_member(org) or not private.has_required_assurance() or
 not (private.inventory_manager(org) or exists(select 1 from public.inventory_requesters r where r.organization_id=org and r.user_id=auth.uid())) then raise exception 'Inventory access denied' using errcode='42501'; end if;
 if resource in ('inventory_assets','inventory_stored') and not private.inventory_manager(org) then raise exception 'Inventory manager permission required' using errcode='42501'; end if;
 return query with choices as (
 select p.user_id id,p.display_name label,m.status='active' active from public.profiles p join public.organization_memberships m using(organization_id,user_id) where p.organization_id=org and resource='inventory_people'
 union all select a.id,a.tag||' · '||a.name||coalesce(' · '||a.serial_number,''),case when resource='inventory_printers' then a.status<>'retired' else a.status='available' and a.assigned_user_id is null end from public.assets a where a.organization_id=org and ((resource='inventory_printers' and a.kind='printer') or resource='inventory_assets' or (resource='inventory_stored' and exists(select 1 from public.inventory_equipment e where e.organization_id=org and e.asset_id=a.id and e.item_id=parent and e.state='stored')))
 ) select c.id,c.label,c.active,null::uuid from choices c where case when selected is not null then c.id=selected else (not active_only or c.active) and c.label ilike all(private.search_patterns(query)) and (after_id is null or (c.label,c.id)>(after_label,after_id)) end order by c.label,c.id limit 51;
end $$;
create function public.inventory_choices(org uuid,resource text,query text default '',after_label text default null,after_id uuid default null,selected uuid default null,parent uuid default null,active_only boolean default true)
returns table(id uuid,label text,active boolean,parent_id uuid) language sql stable security invoker set search_path='' as $$select * from private.inventory_choices(org,resource,query,after_label,after_id,selected,parent,active_only);$$;
revoke all on function private.inventory_choices(uuid,text,text,text,uuid,uuid,uuid,boolean),public.inventory_choices(uuid,text,text,text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.inventory_choices(uuid,text,text,text,uuid,uuid,uuid,boolean),public.inventory_choices(uuid,text,text,text,uuid,uuid,uuid,boolean) to authenticated;
revoke all on function private.guard_ticket_request_kind() from public,anon,authenticated;

alter policy assets_read on public.assets using(private.can_work_tickets(organization_id) or (private.is_active_organization_member(organization_id) and assigned_user_id=(select auth.uid())) or (private.inventory_manager(organization_id) and exists(select 1 from public.inventory_equipment e where e.organization_id=assets.organization_id and e.asset_id=assets.id)));
