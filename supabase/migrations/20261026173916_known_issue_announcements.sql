begin;
-- Drafts are staff-only. Employee-visible content is an approved snapshot, never
-- a join to a mutable draft or any internal incident fields.
create table public.service_announcement_drafts (
 ticket_id uuid primary key, organization_id uuid not null,
 title text not null check(char_length(trim(title)) between 3 and 180),
 body text not null check(char_length(trim(body)) between 3 and 3000),
 revision bigint not null default 1, updated_by uuid not null, updated_at timestamptz not null default now(),
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(ticket_id) references public.ticket_workflows(ticket_id) on delete cascade,
 foreign key(organization_id,updated_by) references public.organization_memberships(organization_id,user_id)
);
create index service_announcement_drafts_org_idx on public.service_announcement_drafts(organization_id,ticket_id);
create table public.service_announcements (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, ticket_id uuid not null,
 title text not null, body text not null, draft_revision bigint not null,
 published_by uuid not null, published_at timestamptz not null default now(), withdrawn_at timestamptz,
 foreign key(organization_id,ticket_id) references public.tickets(organization_id,id) on delete cascade,
 foreign key(organization_id,published_by) references public.organization_memberships(organization_id,user_id),
 unique(ticket_id,draft_revision)
);
create unique index service_announcements_active_ticket_idx on public.service_announcements(ticket_id) where withdrawn_at is null;
create index service_announcements_active_org_idx on public.service_announcements(organization_id,published_at desc,id desc) where withdrawn_at is null;
alter table public.service_announcement_drafts enable row level security;
alter table public.service_announcements enable row level security;
revoke all on public.service_announcement_drafts,public.service_announcements from public,anon,authenticated,service_role;
grant select on public.service_announcement_drafts,public.service_announcements to authenticated;
create policy "Staff read announcement drafts" on public.service_announcement_drafts for select to authenticated
 using(private.can_work_tickets(organization_id) and (select private.has_required_assurance()));
create policy "Members read active approved announcements" on public.service_announcements for select to authenticated
 using(private.is_active_organization_member(organization_id) and (select private.has_required_assurance())
 and (withdrawn_at is null or private.can_work_tickets(organization_id)));

create function private.manage_service_announcement(org uuid,ticket uuid,expected_revision bigint,operation text,payload jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare draft public.service_announcement_drafts; workflow public.ticket_workflows;
 ticket_status public.ticket_status; result bigint; actor_name text; heading text; message text;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then
  raise exception 'Announcement access denied' using errcode='42501'; end if;
 -- Match ticket -> announcement lock order used by the automatic withdrawal trigger.
 select status into ticket_status from public.tickets where organization_id=org and id=ticket for update;
 if not found then raise exception 'Ticket unavailable' using errcode='42501'; end if;
 select * into workflow from public.ticket_workflows where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Workflow unavailable' using errcode='42501'; end if;
 select * into draft from public.service_announcement_drafts where organization_id=org and ticket_id=ticket;
 if expected_revision is null or expected_revision<>coalesce(draft.revision,0) then
  raise exception 'Announcement changed; review the latest saved draft' using errcode='PT409'; end if;
 if ticket_status in ('resolved','closed') then raise exception 'Reopen the ticket before publishing an announcement'; end if;
 if operation='save' then
  heading:=trim(payload->>'title'); message:=trim(payload->>'body');
  if heading is null or message is null or char_length(heading) not between 3 and 180 or char_length(message) not between 3 and 3000 then
   raise exception 'Enter a title (3–180 characters) and message (3–3000 characters)'; end if;
  insert into public.service_announcement_drafts(ticket_id,organization_id,title,body,updated_by)
   values(ticket,org,heading,message,auth.uid()) on conflict(ticket_id) do update
   set title=excluded.title,body=excluded.body,updated_by=excluded.updated_by,updated_at=now(),revision=service_announcement_drafts.revision+1
   returning revision into result;
 elsif operation in ('publish','withdraw') then
  if workflow.owner_id<>auth.uid() and not exists(select 1 from public.organization_memberships
    where organization_id=org and user_id=auth.uid() and status='active' and role='administrator') then
   raise exception 'Only the coordinator or an administrator can publish or remove announcements' using errcode='42501'; end if;
  if draft.ticket_id is null then raise exception 'Save and review a draft first'; end if;
  if operation='publish' then
   if payload->>'confirm' is distinct from 'yes' then raise exception 'Confirm the saved message is suitable for everyone in the workspace'; end if;
   -- Retrying the same approval never republishes or creates a second notice.
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision and withdrawn_at is null) then return draft.revision; end if;
   if exists(select 1 from public.service_announcements where ticket_id=ticket and draft_revision=draft.revision) then raise exception 'Save a new draft before republishing a removed announcement'; end if;
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   insert into public.service_announcements(organization_id,ticket_id,title,body,draft_revision,published_by)
    values(org,ticket,draft.title,draft.body,draft.revision,auth.uid());
  else
   update public.service_announcements set withdrawn_at=now() where ticket_id=ticket and withdrawn_at is null;
   if not found then return draft.revision; end if;
  end if;
  result:=draft.revision;
 else raise exception 'Unknown announcement action'; end if;
 select display_name into actor_name from public.profiles where organization_id=org and user_id=auth.uid();
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(org,auth.uid(),coalesce(actor_name,'IT staff'),'service_announcements',ticket,coalesce(heading,draft.title),
 'updated',jsonb_build_array(jsonb_build_object('field','announcement_action','from',null,'to',operation)));
 return result;
end $$;
revoke all on function private.manage_service_announcement(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.manage_service_announcement(uuid,uuid,bigint,text,jsonb) to authenticated;
create function public.manage_service_announcement(org uuid,ticket uuid,expected_revision bigint,operation text,payload jsonb default '{}'::jsonb)
returns bigint language sql security invoker set search_path='' as $$
 select private.manage_service_announcement(org,ticket,expected_revision,operation,payload);
$$;
revoke all on function public.manage_service_announcement(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_service_announcement(uuid,uuid,bigint,text,jsonb) to authenticated;

create function private.withdraw_resolved_announcements() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('resolved','closed') then
  update public.service_announcements set withdrawn_at=now() where organization_id=new.organization_id and ticket_id=new.id and withdrawn_at is null;
 end if;
 return new;
end $$;
revoke all on function private.withdraw_resolved_announcements() from public,anon,authenticated,service_role;
create trigger tickets_withdraw_service_announcements after update of status on public.tickets
 for each row when (old.status is distinct from new.status) execute function private.withdraw_resolved_announcements();
commit;
