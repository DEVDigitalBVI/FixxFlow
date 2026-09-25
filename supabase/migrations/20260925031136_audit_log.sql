create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_id uuid,
  actor_name text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_label text not null,
  action text not null check (action in ('created','updated','deleted')),
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  search_text text generated always as (actor_name || ' ' || entity_label || ' ' || action) stored
);
create index audit_events_org_time_idx on public.audit_events(organization_id,created_at desc,id desc);
create index audit_events_org_entity_time_idx on public.audit_events(organization_id,entity_type,created_at desc,id desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;
create policy "Administrators can read organization audit events" on public.audit_events
for select to authenticated using ((select private.has_organization_role(organization_id,array['administrator']::public.app_role[])));

-- Audited business mutations and their audit record commit or roll back together.
create function private.audit_display_value(org uuid, field_name text, field_value jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare label text; raw text := field_value #>> '{}';
begin
  if raw is null then return 'null'::jsonb; end if;
  if field_name in ('assigned_technician_id','requester_id') then
    select display_name into label from public.profiles where organization_id=org and user_id=raw::uuid;
  elsif field_name='department_id' then
    select name into label from public.departments where organization_id=org and id=raw::uuid;
  elsif field_name='location_id' then
    select name into label from public.locations where organization_id=org and id=raw::uuid;
  elsif field_name='team_id' then
    select name into label from public.teams where organization_id=org and id=raw::uuid;
  elsif field_name='category_id' then
    select name into label from public.ticket_categories where organization_id=org and id=raw::uuid;
  elsif field_name='subcategory_id' then
    select name into label from public.ticket_subcategories where organization_id=org and id=raw::uuid;
  elsif field_name='ticket_id' then
    select 'Ticket #'||ticket_number into label from public.tickets where organization_id=org and id=raw::uuid;
  end if;
  return coalesce(to_jsonb(label),field_value);
end $$;
revoke all on function private.audit_display_value(uuid,text,jsonb) from public,anon,authenticated;

create function private.record_audit_event()
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
    when 'ticket_categories' then fields:=array['name','is_active']; target_label:=current_row->>'name';
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
revoke all on function private.record_audit_event() from public,anon,authenticated;

do $$ declare source text; begin
  foreach source in array array['tickets','organization_memberships','organizations','profiles','departments','locations','teams','ticket_categories','ticket_subcategories','knowledge_articles','chat_conversations','ticket_messages'] loop
    execute format('create trigger record_audit_event after insert or update or delete on public.%I for each row execute function private.record_audit_event()',source);
  end loop;
end $$;

create function private.protect_audit_event()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit events are append-only'; end $$;
revoke all on function private.protect_audit_event() from public,anon,authenticated;
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function private.protect_audit_event();

-- Existing invitation flow already uses the service key. Complete its database
-- writes atomically and preserve the verified administrator as the audit actor.
create function public.register_invited_member(target_organization_id uuid, invited_user_id uuid, invited_role public.app_role, invited_name text, invited_email text, invited_by uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.organization_memberships where organization_id=target_organization_id and user_id=invited_by and role='administrator' and status='active') then raise exception 'Active administrator required'; end if;
  perform set_config('app.audit_actor',invited_by::text,true);
  perform set_config('app.audit_subject',invited_user_id::text,true);
  perform set_config('app.audit_subject_name',invited_name,true);
  insert into public.organization_memberships(organization_id,user_id,role) values(target_organization_id,invited_user_id,invited_role);
  insert into public.profiles(organization_id,user_id,display_name,email) values(target_organization_id,invited_user_id,invited_name,invited_email);
  perform set_config('app.audit_actor','',true);
  perform set_config('app.audit_subject','',true);
  perform set_config('app.audit_subject_name','',true);
end $$;
revoke all on function public.register_invited_member(uuid,uuid,public.app_role,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_invited_member(uuid,uuid,public.app_role,text,text,uuid) to service_role;
