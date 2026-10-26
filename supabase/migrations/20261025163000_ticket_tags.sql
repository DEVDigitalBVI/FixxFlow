-- Ticket tags: short internal labels for grouping and filtering staff work.
-- Kept in a staff-only table (not a tickets column) because requesters can read
-- their own ticket rows, and tags such as "vip" are internal.
create table public.ticket_tags (
  organization_id uuid not null,
  ticket_id uuid not null,
  tag text not null check(tag ~ '^[a-z0-9][a-z0-9 ._-]{0,39}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,ticket_id,tag),
  foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id)
);
create index ticket_tags_tag_idx on public.ticket_tags(organization_id,tag,ticket_id);

-- Normalize to one lowercase, single-spaced form and cap tags per ticket.
create function private.prepare_ticket_tag() returns trigger language plpgsql set search_path='' as $$
begin
  new.tag := regexp_replace(lower(trim(new.tag)),'\s+',' ','g');
  new.created_at := now();
  perform 1 from public.tickets where organization_id=new.organization_id and id=new.ticket_id for update;
  if (select count(*) from public.ticket_tags where organization_id=new.organization_id and ticket_id=new.ticket_id)>=10 then
    raise exception 'A ticket can have up to 10 tags' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.prepare_ticket_tag() from public,anon,authenticated;
create trigger ticket_tags_prepare before insert on public.ticket_tags
  for each row execute function private.prepare_ticket_tag();

alter table public.ticket_tags enable row level security;
create policy ticket_tags_read on public.ticket_tags for select to authenticated
  using ((select private.can_work_tickets(organization_id)));
create policy ticket_tags_add on public.ticket_tags for insert to authenticated
  with check ((select private.can_work_tickets(organization_id)) and created_by=(select auth.uid()));
create policy ticket_tags_remove on public.ticket_tags for delete to authenticated
  using ((select private.can_work_tickets(organization_id)));
create policy require_enrolled_mfa on public.ticket_tags as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.ticket_tags from public,anon,authenticated;
grant select,delete on public.ticket_tags to authenticated;
grant insert(organization_id,ticket_id,tag,created_by) on public.ticket_tags to authenticated;
grant all on public.ticket_tags to service_role;

-- Audit in the administrator-only log (ticket activity is visible to requesters).
create function private.record_ticket_tag_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid:=(row_data->>'organization_id')::uuid; actor uuid:=auth.uid(); actor_name text; number bigint;
begin
  select display_name into actor_name from public.profiles where organization_id=org and user_id=actor;
  actor_name:=coalesce(actor_name,case when actor is null then 'System' else 'Member '||actor::text end);
  select t.ticket_number into number from public.tickets t where t.organization_id=org and t.id=(row_data->>'ticket_id')::uuid;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_name,'ticket_tags',(row_data->>'ticket_id')::uuid,coalesce('Ticket #'||number,'Ticket'),
    case tg_op when 'INSERT' then 'created' else 'deleted' end,
    jsonb_build_array(jsonb_build_object('field','tag','from',case when tg_op='DELETE' then row_data->'tag' else 'null'::jsonb end,
      'to',case when tg_op='INSERT' then row_data->'tag' else 'null'::jsonb end)));
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.record_ticket_tag_audit() from public,anon,authenticated;
create trigger ticket_tags_record_audit after insert or delete on public.ticket_tags
  for each row execute function private.record_ticket_tag_audit();
