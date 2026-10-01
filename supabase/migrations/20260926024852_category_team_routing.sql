-- Defaults are optional; existing categories and tickets keep their assignments.
alter table public.ticket_categories add column default_team_id uuid;
alter table public.ticket_categories add constraint ticket_categories_default_team_fk
  foreign key (organization_id, default_team_id) references public.teams(organization_id, id) on delete restrict;
create index ticket_categories_default_team_idx on public.ticket_categories(organization_id, default_team_id);
alter table public.tickets add column routing_mode text not null default 'automatic' check (routing_mode in ('automatic','manual'));

create function private.route_new_ticket() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then new.routing_mode := 'manual'; return new; end if;
  -- Employees cannot override organization routing through a forged request.
  if not private.can_work_tickets(new.organization_id) then
    new.routing_mode := 'automatic';
    new.team_id := null;
  elsif new.team_id is not null then
    new.routing_mode := 'manual';
  end if;
  if new.routing_mode = 'automatic' and new.team_id is null then
    select t.id into new.team_id from public.ticket_categories c
    join public.teams t on t.organization_id=c.organization_id and t.id=c.default_team_id
    where c.organization_id=new.organization_id and c.id=new.category_id and c.is_active and t.is_active;
  end if;
  return new;
end $$;
revoke all on function private.route_new_ticket() from public,anon,authenticated;
create trigger tickets_route_new before insert on public.tickets for each row execute function private.route_new_ticket();

-- History writes need definer rights; this function is private, trigger-only and tenant-checked.
create function private.record_ticket_routing() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.routing_mode='automatic' and new.team_id is not null then
    if auth.uid() is null or not private.is_active_organization_member(new.organization_id) or not private.has_required_assurance() then
      raise exception 'Access denied' using errcode='42501';
    end if;
    insert into public.ticket_activity(organization_id,ticket_id,actor_id,action,details)
    select new.organization_id,new.id,null,'automatically_routed',jsonb_build_object('team_id',t.id,'team_name',t.name,'category_id',new.category_id)
    from public.teams t where t.organization_id=new.organization_id and t.id=new.team_id;
  end if;
  return new;
end $$;
revoke all on function private.record_ticket_routing() from public,anon,authenticated;
create trigger tickets_record_routing after insert on public.tickets for each row execute function private.record_ticket_routing();

-- Include routing-policy changes in the existing administrator audit trail.
create or replace function private.record_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  current_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid; actor uuid := auth.uid(); actor_label text; target uuid; target_label text;
  fields text[]; key text; before_value jsonb; after_value jsonb; delta jsonb := '[]'::jsonb;
  ticket_number bigint;
begin
  org := case when tg_table_name='organizations' then (current_row->>'id')::uuid else (current_row->>'organization_id')::uuid end;
  target := coalesce(current_row->>'id',current_row->>'user_id')::uuid;
  -- Only the trusted service-role invitation RPC supplies an actor context.
  if actor is null and current_setting('role',true)='service_role' then
    actor := nullif(current_setting('app.audit_actor',true),'')::uuid;
  end if;
  select display_name into actor_label from public.profiles where organization_id=org and user_id=actor;
  actor_label := coalesce(actor_label,case when actor is null then 'System' else 'Member '||actor::text end);
  case tg_table_name
    when 'tickets' then fields:=array['title','description','status','priority','requester_id','assigned_technician_id','team_id','category_id','subcategory_id','location_id','due_at']; target_label:='Ticket #'||(current_row->>'ticket_number');
    when 'organization_memberships' then
      fields:=array['role','status'];
      select display_name into target_label from public.profiles where organization_id=org and user_id=target;
      if target_label is null and current_setting('role',true)='service_role' and current_row->>'user_id'=current_setting('app.audit_subject',true) then target_label:=nullif(current_setting('app.audit_subject_name',true),''); end if;
      target_label:=coalesce(target_label,'Member '||target::text);
    when 'organizations' then fields:=array['name','slug','logo_path']; target_label:=current_row->>'name';
    when 'profiles' then fields:=array['display_name','department_id','location_id']; target_label:=current_row->>'display_name';
    when 'departments' then fields:=array['name','description','is_active']; target_label:=current_row->>'name';
    when 'locations' then fields:=array['name','timezone','is_active']; target_label:=current_row->>'name';
    when 'teams' then fields:=array['name','is_active']; target_label:=current_row->>'name';
    when 'ticket_categories' then fields:=array['name','is_active','default_team_id']; target_label:=current_row->>'name';
    when 'ticket_subcategories' then fields:=array['name','category_id','is_active']; target_label:=current_row->>'name';
    when 'knowledge_articles' then fields:=array['title','category','status','content','related_article_ids']; target_label:=current_row->>'title';
    when 'chat_conversations' then fields:=array['status','assigned_technician_id','ticket_id']; target_label:='Chat '||left(target::text,8);
    when 'ticket_messages' then
      fields:=array['kind','body'];
      select t.ticket_number into ticket_number from public.tickets t where t.organization_id=org and t.id=(current_row->>'ticket_id')::uuid;
      target_label:=coalesce('Ticket #'||ticket_number,'Ticket')||case when current_row->>'kind'='internal_note' then ' · internal note' else ' · public reply' end;
    else raise exception 'Unsupported audit source';
  end case;
  foreach key in array fields loop
    before_value:=case when tg_op='INSERT' then 'null'::jsonb else previous->key end;
    after_value:=case when tg_op='DELETE' then 'null'::jsonb else current_row->key end;
    if before_value is distinct from after_value then
      -- Record that content changed, never duplicate bodies, notes, or storage paths.
      if key in ('description','body','content','logo_path','related_article_ids') then
        before_value:=case when before_value is null or before_value='null'::jsonb then 'null'::jsonb else '"Previous content"'::jsonb end;
        after_value:=case when after_value is null or after_value='null'::jsonb then 'null'::jsonb else '"Content updated"'::jsonb end;
      else
        before_value:=private.audit_display_value(org,key,before_value);
        after_value:=private.audit_display_value(org,key,after_value);
      end if;
      delta:=delta||jsonb_build_array(jsonb_build_object('field',key,'from',before_value,'to',after_value));
    end if;
  end loop;
  if tg_op='UPDATE' and jsonb_array_length(delta)=0 then return new; end if;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_label,tg_table_name,target,coalesce(target_label,tg_table_name),case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
  return case when tg_op='DELETE' then old else new end;
end $$;
