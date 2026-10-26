-- Saved replies: reusable reply text shared by a workspace's IT staff.
-- Any technician or administrator can use and create them; the author or an
-- administrator can edit or delete. Employees never read them.
create table public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 2 and 120),
  body text not null check(char_length(trim(body)) between 1 and 10000),
  created_by uuid not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id)
);
create unique index saved_replies_title_unique on public.saved_replies(organization_id,lower(trim(title)));
create index saved_replies_author_idx on public.saved_replies(organization_id,created_by);

-- Server-owned fields: identity and ownership never change; revisions guard concurrent edits.
create function private.prepare_saved_reply() returns trigger language plpgsql set search_path='' as $$
begin
  new.title := trim(new.title);
  if tg_op='INSERT' then
    new.revision := 1; new.created_at := now(); new.updated_at := now();
  else
    if row(new.id,new.organization_id,new.created_by,new.created_at) is distinct from row(old.id,old.organization_id,old.created_by,old.created_at) then
      raise exception 'Saved reply identity cannot change' using errcode='42501';
    end if;
    new.revision := old.revision+1; new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function private.prepare_saved_reply() from public,anon,authenticated;
create trigger saved_replies_prepare before insert or update on public.saved_replies
  for each row execute function private.prepare_saved_reply();

alter table public.saved_replies enable row level security;
create policy saved_replies_read on public.saved_replies for select to authenticated
  using ((select private.can_work_tickets(organization_id)));
create policy saved_replies_create on public.saved_replies for insert to authenticated
  with check ((select private.can_work_tickets(organization_id)) and created_by=(select auth.uid()));
create policy saved_replies_update on public.saved_replies for update to authenticated
  using ((select private.can_work_tickets(organization_id)) and (created_by=(select auth.uid())
    or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))))
  with check ((select private.can_work_tickets(organization_id)) and (created_by=(select auth.uid())
    or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
create policy saved_replies_delete on public.saved_replies for delete to authenticated
  using ((select private.can_work_tickets(organization_id)) and (created_by=(select auth.uid())
    or (select private.has_organization_role(organization_id,array['administrator']::public.app_role[]))));
create policy require_enrolled_mfa on public.saved_replies as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.saved_replies from public,anon,authenticated;
grant select,delete on public.saved_replies to authenticated;
grant insert(organization_id,title,body,created_by),update(title,body) on public.saved_replies to authenticated;
grant all on public.saved_replies to service_role;

-- Audit: titles are recorded; reply text is represented only by a change marker.
create function private.record_saved_reply_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  current_row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid:=(current_row->>'organization_id')::uuid; actor uuid:=auth.uid(); actor_name text;
  field text; before_value jsonb; after_value jsonb; delta jsonb:='[]'::jsonb;
begin
  select display_name into actor_name from public.profiles where organization_id=org and user_id=actor;
  actor_name:=coalesce(actor_name,case when actor is null then 'System' else 'Member '||actor::text end);
  foreach field in array array['title','body'] loop
    before_value:=case when tg_op='INSERT' then 'null'::jsonb else previous->field end;
    after_value:=case when tg_op='DELETE' then 'null'::jsonb else current_row->field end;
    if before_value is distinct from after_value then
      if field='body' then
        before_value:=case when before_value is null or before_value='null'::jsonb then 'null'::jsonb else '"Previous content"'::jsonb end;
        after_value:=case when after_value is null or after_value='null'::jsonb then 'null'::jsonb else '"Content updated"'::jsonb end;
      end if;
      delta:=delta||jsonb_build_array(jsonb_build_object('field',field,'from',before_value,'to',after_value));
    end if;
  end loop;
  if tg_op='UPDATE' and jsonb_array_length(delta)=0 then return new; end if;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_name,'saved_replies',(current_row->>'id')::uuid,coalesce(current_row->>'title','Saved reply'),
    case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,delta);
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.record_saved_reply_audit() from public,anon,authenticated;
create trigger saved_replies_record_audit after insert or update or delete on public.saved_replies
  for each row execute function private.record_saved_reply_audit();
