begin;

create table private.app_sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 revoked_at timestamptz
);
alter table private.app_sessions enable row level security;
revoke all on private.app_sessions from public,anon,authenticated,service_role;
create policy app_sessions_client_denied on private.app_sessions for all to authenticated using(false) with check(false);

create function private.has_active_session() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.sessions s where s.user_id=auth.uid()
  and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())
  and not exists(select 1 from private.app_sessions a where a.session_id=s.id and a.revoked_at is not null));
$$;
revoke all on function private.has_active_session() from public,anon,authenticated,service_role;
grant execute on function private.has_active_session() to authenticated;

create function private.revoke_app_session() returns boolean language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if auth.uid() is null then return false; end if;
 select id into target from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id';
 if target is null then return true; end if;
 insert into private.app_sessions(session_id,user_id,revoked_at) values(target,auth.uid(),clock_timestamp())
 on conflict(session_id) do update set revoked_at=coalesce(app_sessions.revoked_at,excluded.revoked_at);
 return true;
end $$;
revoke all on function private.revoke_app_session() from public,anon,authenticated,service_role;
grant execute on function private.revoke_app_session() to authenticated;
create function public.revoke_app_session() returns boolean language sql security invoker set search_path='' as $$select private.revoke_app_session();$$;
revoke all on function public.revoke_app_session() from public,anon,authenticated,service_role;
grant execute on function public.revoke_app_session() to authenticated;

create function private.app_session_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('active',private.has_active_session(),'user_id',auth.uid());
$$;
revoke all on function private.app_session_state() from public,anon,authenticated,service_role;
grant execute on function private.app_session_state() to authenticated;
create function public.app_session_state() returns jsonb language sql security invoker set search_path='' as $$select private.app_session_state();$$;
revoke all on function public.app_session_state() from public,anon,authenticated,service_role;
grant execute on function public.app_session_state() to authenticated;

create or replace function private.has_required_assurance() returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_active_session() and case when exists(
   select 1 from public.organization_memberships m join public.workspace_security_policies p on p.organization_id=m.organization_id
   where m.user_id=auth.uid() and m.status='active' and p.require_mfa
 ) then coalesce(auth.jwt()->>'aal'='aal2',false) and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
 else coalesce(auth.jwt()->>'aal'='aal2',false) or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') end;
$$;
create or replace function private.account_authentication_policy() returns table(mfa_required boolean,has_verified_factor boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_active_session() then raise exception 'Sign in required' using errcode='42501'; end if;
 return query select exists(select 1 from public.workspace_security_policies p join public.organization_memberships m on m.organization_id=p.organization_id
   where m.user_id=auth.uid() and m.status='active' and p.require_mfa),
 exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified');
end $$;
create or replace function private.platform_access() returns text language sql stable security definer set search_path='' as $$
 select case when not private.has_active_session() or not exists(select 1 from private.platform_owners where user_id=auth.uid()) or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now())) then 'none'
 when not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') then 'enroll'
 when auth.jwt()->>'aal' is distinct from 'aal2' then 'verify' else 'ready' end;
$$;

-- AND this guard with existing tenant/role policies. It grants no new access.
do $$ declare target record;
begin
 for target in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity and (n.nspname='public' or n.nspname='storage' and c.relname='objects' or n.nspname='realtime' and c.relname='messages')
 loop
  execute format('create policy app_active_session on %I.%I as restrictive for all to authenticated using ((select private.has_active_session())) with check ((select private.has_active_session()))',target.nspname,target.relname);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
