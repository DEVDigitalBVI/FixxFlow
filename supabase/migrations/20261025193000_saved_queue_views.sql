-- Personal saved ticket-queue views: a name plus the queue's filter query string.
-- Only the owner (an IT staff member) can see or change their views.
create table public.saved_queue_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  name text not null check(char_length(trim(name)) between 1 and 60),
  query text not null check(char_length(query) <= 1000 and query !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create unique index saved_queue_views_name_unique on public.saved_queue_views(organization_id,user_id,lower(trim(name)));

create function private.prepare_saved_queue_view() returns trigger language plpgsql set search_path='' as $$
begin
  new.name := trim(new.name);
  new.created_at := now();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saved-queue-views:'||new.user_id::text,0));
  if (select count(*) from public.saved_queue_views where organization_id=new.organization_id and user_id=new.user_id)>=20 then
    raise exception 'You can save up to 20 queue views' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.prepare_saved_queue_view() from public,anon,authenticated;
create trigger saved_queue_views_prepare before insert on public.saved_queue_views
  for each row execute function private.prepare_saved_queue_view();

alter table public.saved_queue_views enable row level security;
create policy saved_queue_views_own on public.saved_queue_views for all to authenticated
  using ((select private.can_work_tickets(organization_id)) and user_id=(select auth.uid()))
  with check ((select private.can_work_tickets(organization_id)) and user_id=(select auth.uid()));
create policy require_enrolled_mfa on public.saved_queue_views as restrictive for all to authenticated
  using ((select private.has_required_assurance())) with check ((select private.has_required_assurance()));
revoke all on public.saved_queue_views from public,anon,authenticated;
grant select,delete on public.saved_queue_views to authenticated;
grant insert(organization_id,user_id,name,query) on public.saved_queue_views to authenticated;
grant all on public.saved_queue_views to service_role;
