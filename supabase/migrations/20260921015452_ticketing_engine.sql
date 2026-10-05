create type public.ticket_status as enum (
  'new', 'open', 'in_progress', 'waiting_on_user', 'on_hold', 'resolved', 'closed'
);
create type public.ticket_priority as enum ('low', 'normal', 'high', 'critical');
create type public.ticket_message_kind as enum ('reply', 'internal_note');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.ticket_subcategories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  category_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, category_id, id),
  unique (organization_id, category_id, name),
  foreign key (organization_id, category_id)
    references public.ticket_categories(organization_id, id) on delete cascade
);

create table private.ticket_number_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_number bigint not null default 1001 check (next_number > 0)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_number bigint not null,
  title text not null check (char_length(trim(title)) between 3 and 180),
  description text not null check (char_length(trim(description)) between 1 and 20000),
  requester_id uuid not null,
  assigned_technician_id uuid,
  team_id uuid,
  category_id uuid,
  subcategory_id uuid,
  priority public.ticket_priority not null default 'normal',
  status public.ticket_status not null default 'new',
  location_id uuid,
  first_response_at timestamptz,
  due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subcategory_id is null or category_id is not null),
  unique (organization_id, id),
  unique (organization_id, ticket_number),
  foreign key (organization_id, requester_id)
    references public.organization_memberships(organization_id, user_id),
  foreign key (organization_id, assigned_technician_id)
    references public.organization_memberships(organization_id, user_id),
  foreign key (organization_id, team_id)
    references public.teams(organization_id, id),
  foreign key (organization_id, category_id)
    references public.ticket_categories(organization_id, id),
  foreign key (organization_id, category_id, subcategory_id)
    references public.ticket_subcategories(organization_id, category_id, id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id)
);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ticket_id uuid not null,
  author_id uuid not null,
  kind public.ticket_message_kind not null default 'reply',
  body text not null check (char_length(trim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, ticket_id)
    references public.tickets(organization_id, id) on delete cascade,
  foreign key (organization_id, author_id)
    references public.organization_memberships(organization_id, user_id)
);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ticket_id uuid not null,
  uploaded_by uuid not null,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  foreign key (organization_id, ticket_id)
    references public.tickets(organization_id, id) on delete cascade,
  foreign key (organization_id, uploaded_by)
    references public.organization_memberships(organization_id, user_id)
);

create table public.ticket_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  ticket_id uuid not null,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, ticket_id)
    references public.tickets(organization_id, id) on delete cascade
);

create index teams_organization_idx on public.teams (organization_id, is_active);
create index ticket_categories_organization_idx on public.ticket_categories (organization_id, is_active);
create index ticket_subcategories_category_idx on public.ticket_subcategories (organization_id, category_id, is_active);
create index tickets_queue_idx on public.tickets (organization_id, status, priority, updated_at desc);
create index tickets_requester_idx on public.tickets (organization_id, requester_id, updated_at desc);
create index tickets_assignee_idx on public.tickets (organization_id, assigned_technician_id, updated_at desc)
  where assigned_technician_id is not null;
create index ticket_messages_ticket_idx on public.ticket_messages (organization_id, ticket_id, created_at);
create index ticket_attachments_ticket_idx on public.ticket_attachments (organization_id, ticket_id, created_at);
create index ticket_activity_ticket_idx on public.ticket_activity (organization_id, ticket_id, created_at desc);

create or replace function private.can_work_tickets(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public_role.role in ('technician', 'administrator')
  from public.organization_memberships as public_role
  where public_role.organization_id = target_organization_id
    and public_role.user_id = (select auth.uid())
    and public_role.status = 'active';
$$;

create or replace function private.can_view_ticket(target_organization_id uuid, target_ticket_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tickets ticket
    where ticket.organization_id = target_organization_id
      and ticket.id = target_ticket_id
      and (
        ticket.requester_id = (select auth.uid())
        or (select private.can_work_tickets(target_organization_id))
      )
      and (select private.is_active_organization_member(target_organization_id))
  );
$$;

create or replace function private.can_view_ticket_path(target_organization_id text, target_ticket_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when target_organization_id ~* '^[0-9a-f-]{36}$' and target_ticket_id ~* '^[0-9a-f-]{36}$'
    then private.can_view_ticket(target_organization_id::uuid, target_ticket_id::uuid)
    else false
  end;
$$;

revoke all on function private.can_work_tickets(uuid) from public, anon;
revoke all on function private.can_view_ticket(uuid, uuid) from public, anon;
revoke all on function private.can_view_ticket_path(text, text) from public, anon;
grant execute on function private.can_work_tickets(uuid) to authenticated;
grant execute on function private.can_view_ticket(uuid, uuid) to authenticated;
grant execute on function private.can_view_ticket_path(text, text) to authenticated;

create or replace function private.assign_ticket_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare assigned_number bigint;
begin
  insert into private.ticket_number_sequences (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;
  update private.ticket_number_sequences
  set next_number = next_number + 1
  where organization_id = new.organization_id
  returning next_number - 1 into assigned_number;
  new.ticket_number := assigned_number;
  return new;
end;
$$;

create trigger tickets_assign_number before insert on public.tickets
for each row execute function private.assign_ticket_number();

create or replace function private.prepare_ticket_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := now(); end if;
    if new.status <> 'resolved' then new.resolved_at := null; end if;
    if new.status = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
    if new.status <> 'closed' then new.closed_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.record_ticket_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare event_action text;
declare event_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    event_action := 'created';
    event_details := jsonb_build_object('status', new.status, 'priority', new.priority);
  elsif old.status is distinct from new.status then
    event_action := 'status_changed';
    event_details := jsonb_build_object('from', old.status, 'to', new.status);
  elsif old.assigned_technician_id is distinct from new.assigned_technician_id then
    event_action := 'assignment_changed';
    event_details := jsonb_build_object('from', old.assigned_technician_id, 'to', new.assigned_technician_id);
  elsif old.priority is distinct from new.priority then
    event_action := 'priority_changed';
    event_details := jsonb_build_object('from', old.priority, 'to', new.priority);
  elsif old.first_response_at is distinct from new.first_response_at then
    event_action := 'first_response_recorded';
  else
    event_action := 'details_updated';
  end if;
  insert into public.ticket_activity (organization_id, ticket_id, actor_id, action, details)
  values (new.organization_id, new.id, (select auth.uid()), event_action, event_details);
  return new;
end;
$$;

create trigger tickets_prepare_change before update on public.tickets
for each row execute function private.prepare_ticket_change();
create trigger tickets_record_change after insert or update on public.tickets
for each row execute function private.record_ticket_change();

create or replace function private.track_ticket_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'reply' and (select private.can_work_tickets(new.organization_id)) then
    update public.tickets set first_response_at = coalesce(first_response_at, new.created_at)
    where organization_id = new.organization_id and id = new.ticket_id;
  end if;
  insert into public.ticket_activity (organization_id, ticket_id, actor_id, action, details)
  values (new.organization_id, new.ticket_id, new.author_id,
    case when new.kind = 'internal_note' then 'internal_note_added' else 'reply_added' end,
    '{}'::jsonb);
  return new;
end;
$$;

create trigger ticket_messages_track after insert on public.ticket_messages
for each row execute function private.track_ticket_message();

create trigger teams_set_updated_at before update on public.teams
for each row execute function private.set_updated_at();
create trigger ticket_categories_set_updated_at before update on public.ticket_categories
for each row execute function private.set_updated_at();
create trigger ticket_subcategories_set_updated_at before update on public.ticket_subcategories
for each row execute function private.set_updated_at();
create trigger ticket_messages_set_updated_at before update on public.ticket_messages
for each row execute function private.set_updated_at();

create or replace function private.seed_ticket_configuration()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.teams (organization_id, name, description)
  values (new.id, 'IT Support', 'Primary service desk team') on conflict do nothing;
  insert into public.ticket_categories (organization_id, name)
  select new.id, category_name from (values ('Hardware'), ('Software'), ('Access'), ('Network'), ('Other')) categories(category_name)
  on conflict do nothing;
  return new;
end;
$$;

create trigger organizations_seed_ticket_configuration after insert on public.organizations
for each row execute function private.seed_ticket_configuration();

insert into public.teams (organization_id, name, description)
select id, 'IT Support', 'Primary service desk team' from public.organizations on conflict do nothing;
insert into public.ticket_categories (organization_id, name)
select organization.id, category.name
from public.organizations organization
cross join (values ('Hardware'), ('Software'), ('Access'), ('Network'), ('Other')) category(name)
on conflict do nothing;

alter table public.teams enable row level security;
alter table public.ticket_categories enable row level security;
alter table public.ticket_subcategories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_activity enable row level security;

create policy "Active members can view teams" on public.teams for select to authenticated
using ((select private.is_active_organization_member(organization_id)));
create policy "Administrators can insert teams" on public.teams for insert to authenticated
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can update teams" on public.teams for update to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can delete teams" on public.teams for delete to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));

create policy "Active members can view ticket categories" on public.ticket_categories for select to authenticated
using ((select private.is_active_organization_member(organization_id)));
create policy "Administrators can insert ticket categories" on public.ticket_categories for insert to authenticated
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can update ticket categories" on public.ticket_categories for update to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can delete ticket categories" on public.ticket_categories for delete to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));

create policy "Active members can view ticket subcategories" on public.ticket_subcategories for select to authenticated
using ((select private.is_active_organization_member(organization_id)));
create policy "Administrators can insert ticket subcategories" on public.ticket_subcategories for insert to authenticated
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can update ticket subcategories" on public.ticket_subcategories for update to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])))
with check ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));
create policy "Administrators can delete ticket subcategories" on public.ticket_subcategories for delete to authenticated
using ((select private.has_organization_role(organization_id, array['administrator']::public.app_role[])));

create policy "Members can view permitted tickets" on public.tickets for select to authenticated
using (
  (select private.is_active_organization_member(organization_id))
  and (requester_id = (select auth.uid()) or (select private.can_work_tickets(organization_id)))
);
create policy "Members can create permitted tickets" on public.tickets for insert to authenticated
with check (
  (select private.is_active_organization_member(organization_id))
  and (
    (select private.can_work_tickets(organization_id))
    or (
      requester_id = (select auth.uid())
      and assigned_technician_id is null
      and status = 'new'
      and first_response_at is null
      and due_at is null
      and resolved_at is null
      and closed_at is null
    )
  )
);
create policy "Ticket workers can update tickets" on public.tickets for update to authenticated
using ((select private.can_work_tickets(organization_id)))
with check ((select private.can_work_tickets(organization_id)));

create policy "Members can view permitted ticket messages" on public.ticket_messages for select to authenticated
using (
  (select private.can_view_ticket(organization_id, ticket_id))
  and (kind = 'reply' or (select private.can_work_tickets(organization_id)))
);
create policy "Members can add permitted ticket messages" on public.ticket_messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.can_view_ticket(organization_id, ticket_id))
  and (kind = 'reply' or (select private.can_work_tickets(organization_id)))
);

create policy "Members can view permitted attachments" on public.ticket_attachments for select to authenticated
using ((select private.can_view_ticket(organization_id, ticket_id)));
create policy "Members can register permitted attachments" on public.ticket_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select private.can_view_ticket(organization_id, ticket_id))
);
create policy "Uploaders and workers can delete attachment records" on public.ticket_attachments for delete to authenticated
using (uploaded_by = (select auth.uid()) or (select private.can_work_tickets(organization_id)));

create policy "Members can view permitted ticket activity" on public.ticket_activity for select to authenticated
using (
  (select private.can_view_ticket(organization_id, ticket_id))
  and (action <> 'internal_note_added' or (select private.can_work_tickets(organization_id)))
);

revoke all on public.teams, public.ticket_categories, public.ticket_subcategories,
  public.tickets, public.ticket_messages, public.ticket_attachments, public.ticket_activity
  from anon, authenticated;
grant select on public.teams, public.ticket_categories, public.ticket_subcategories to authenticated;
grant insert, update, delete on public.teams, public.ticket_categories, public.ticket_subcategories to authenticated;
grant select, insert on public.tickets to authenticated;
grant update (title, description, assigned_technician_id, team_id, category_id, subcategory_id,
  priority, status, location_id, due_at) on public.tickets to authenticated;
grant select, insert on public.ticket_messages to authenticated;
grant select, insert, delete on public.ticket_attachments to authenticated;
grant select on public.ticket_activity to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 10485760,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Members can read permitted ticket files" on storage.objects for select to authenticated
using (
  bucket_id = 'ticket-attachments'
  and (select private.can_view_ticket_path((storage.foldername(name))[1], (storage.foldername(name))[2]))
);
create policy "Members can upload permitted ticket files" on storage.objects for insert to authenticated
with check (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and (select private.can_view_ticket_path((storage.foldername(name))[1], (storage.foldername(name))[2]))
);
create policy "Uploaders can delete their ticket files" on storage.objects for delete to authenticated
using (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and (select private.can_view_ticket_path((storage.foldername(name))[1], (storage.foldername(name))[2]))
);
