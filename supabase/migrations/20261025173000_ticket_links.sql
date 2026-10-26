-- Related and duplicate ticket links (staff-only).
-- 'related': a two-way association, stored once with the lower ticket id first.
-- 'duplicate': ticket_id is the duplicate, linked_ticket_id the main ticket. Created
-- only by mark_ticket_duplicate, which also closes the duplicate atomically. Nothing
-- moves between tickets, so requesters never see each other's conversations.
create table public.ticket_links (
  organization_id uuid not null,
  ticket_id uuid not null,
  linked_ticket_id uuid not null,
  kind text not null check(kind in ('related','duplicate')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,ticket_id,linked_ticket_id),
  check(ticket_id<>linked_ticket_id),
  foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
  foreign key(organization_id,linked_ticket_id) references public.tickets(organization_id,id) on delete cascade,
  foreign key(organization_id,created_by) references public.organization_memberships(organization_id,user_id)
);
-- One link per pair, in either direction; a ticket duplicates at most one main ticket.
create unique index ticket_links_pair_unique on public.ticket_links
  (organization_id,least(ticket_id,linked_ticket_id),greatest(ticket_id,linked_ticket_id));
create unique index ticket_links_one_main on public.ticket_links(organization_id,ticket_id) where kind='duplicate';
create index ticket_links_linked_idx on public.ticket_links(organization_id,linked_ticket_id);

create function private.prepare_ticket_link() returns trigger language plpgsql set search_path='' as $$
declare first uuid;
begin
  new.created_at := now();
  if new.kind='related' and new.ticket_id>new.linked_ticket_id then
    first := new.ticket_id; new.ticket_id := new.linked_ticket_id; new.linked_ticket_id := first;
  end if;
  return new;
end $$;
revoke all on function private.prepare_ticket_link() from public,anon,authenticated;
create trigger ticket_links_prepare before insert on public.ticket_links
  for each row execute function private.prepare_ticket_link();

alter table public.ticket_links enable row level security;
create policy ticket_links_read on public.ticket_links for select to authenticated
  using ((select private.can_work_tickets(organization_id)));
-- Direct inserts may only relate tickets; duplicates go through mark_ticket_duplicate.
create policy ticket_links_add on public.ticket_links for insert to authenticated
  with check ((select private.can_work_tickets(organization_id)) and kind='related' and created_by=(select auth.uid()));
create policy ticket_links_remove on public.ticket_links for delete to authenticated
  using ((select private.can_work_tickets(organization_id)));
create policy require_enrolled_mfa on public.ticket_links as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.ticket_links from public,anon,authenticated;
grant select,delete on public.ticket_links to authenticated;
grant insert(organization_id,ticket_id,linked_ticket_id,kind,created_by) on public.ticket_links to authenticated;
grant all on public.ticket_links to service_role;

-- Close a ticket as a duplicate of another, atomically.
create function public.mark_ticket_duplicate(
  org uuid, duplicate uuid, main uuid, expected_revision bigint, requester_message text default null
) returns bigint language plpgsql security definer set search_path='' as $$
declare dup public.tickets%rowtype; main_number bigint; message text:=nullif(trim(requester_message),''); result bigint;
begin
  if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then
    raise exception 'Only IT staff can close duplicates' using errcode='42501';
  end if;
  if duplicate=main then raise exception 'Choose a different main ticket' using errcode='22023'; end if;
  if message is not null and char_length(message)>20000 then raise exception 'Message is too long' using errcode='22023'; end if;
  select * into dup from public.tickets where organization_id=org and id=duplicate for update;
  if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
  if dup.revision<>expected_revision then raise exception 'Ticket changed; review the latest details' using errcode='PT409'; end if;
  if dup.status='closed' then raise exception 'This ticket is already closed' using errcode='22023'; end if;
  select ticket_number into main_number from public.tickets where organization_id=org and id=main;
  if main_number is null then raise exception 'Main ticket not found in this workspace' using errcode='22023'; end if;
  if exists(select 1 from public.ticket_links where organization_id=org and kind='duplicate' and ticket_id=main) then
    raise exception 'That ticket is itself a duplicate; choose its main ticket instead' using errcode='22023';
  end if;
  -- Replace any existing link between the two with the duplicate relationship.
  delete from public.ticket_links where organization_id=org
    and least(ticket_id,linked_ticket_id)=least(duplicate,main) and greatest(ticket_id,linked_ticket_id)=greatest(duplicate,main);
  insert into public.ticket_links(organization_id,ticket_id,linked_ticket_id,kind,created_by)
    values(org,duplicate,main,'duplicate',auth.uid());
  insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values
    (org,duplicate,auth.uid(),'internal_note','Closed as a duplicate of ticket #'||main_number||'.'),
    (org,main,auth.uid(),'internal_note','Ticket #'||dup.ticket_number||' was closed as a duplicate of this ticket.');
  if message is not null then
    insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values(org,duplicate,auth.uid(),'reply',message);
  end if;
  update public.tickets set status='closed' where organization_id=org and id=duplicate returning revision into result;
  return result;
end $$;
revoke all on function public.mark_ticket_duplicate(uuid,uuid,uuid,bigint,text) from public,anon;
grant execute on function public.mark_ticket_duplicate(uuid,uuid,uuid,bigint,text) to authenticated;

-- Audit in the administrator-only log.
create function private.record_ticket_link_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org uuid:=(row_data->>'organization_id')::uuid; actor uuid:=auth.uid(); actor_name text; a bigint; b bigint; link text;
begin
  select display_name into actor_name from public.profiles where organization_id=org and user_id=actor;
  actor_name:=coalesce(actor_name,case when actor is null then 'System' else 'Member '||actor::text end);
  select ticket_number into a from public.tickets where organization_id=org and id=(row_data->>'ticket_id')::uuid;
  select ticket_number into b from public.tickets where organization_id=org and id=(row_data->>'linked_ticket_id')::uuid;
  link:=case when row_data->>'kind'='duplicate' then 'Duplicate of #'||coalesce(b::text,'?') else 'Related to #'||coalesce(b::text,'?') end;
  insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
  values(org,actor,actor_name,'ticket_links',(row_data->>'ticket_id')::uuid,coalesce('Ticket #'||a,'Ticket'),
    case tg_op when 'INSERT' then 'created' else 'deleted' end,
    jsonb_build_array(jsonb_build_object('field','link','from',case when tg_op='DELETE' then to_jsonb(link) else 'null'::jsonb end,
      'to',case when tg_op='INSERT' then to_jsonb(link) else 'null'::jsonb end)));
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.record_ticket_link_audit() from public,anon,authenticated;
create trigger ticket_links_record_audit after insert or delete on public.ticket_links
  for each row execute function private.record_ticket_link_audit();
