begin;
alter table private.app_sessions add column last_activity_at timestamptz not null default now();
-- Existing sessions receive a single migration-time grace period. New sessions
-- use Auth creation time until their first genuine activity heartbeat.
insert into private.app_sessions(session_id,user_id,last_activity_at)
select id,user_id,clock_timestamp() from auth.sessions on conflict(session_id) do nothing;

create or replace function private.has_active_session() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from auth.sessions s left join private.app_sessions a on a.session_id=s.id
 where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
 and (s.not_after is null or s.not_after>now()) and a.revoked_at is null
 and coalesce(a.last_activity_at,s.created_at)+interval '30 minutes'>now());
$$;
create or replace function private.app_session_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('active',private.has_active_session(),'user_id',auth.uid(),
 'server_now',now(),'idle_deadline',(
 select coalesce(a.last_activity_at,s.created_at)+interval '30 minutes'
 from auth.sessions s left join private.app_sessions a on a.session_id=s.id
 where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'));
$$;
create function private.touch_app_session() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- Validate first; a heartbeat cannot resurrect an expired or revoked session.
 if not private.has_active_session() then return private.app_session_state(); end if;
 insert into private.app_sessions(session_id,user_id,last_activity_at)
 select id,user_id,clock_timestamp() from auth.sessions
 where user_id=auth.uid() and id::text=auth.jwt()->>'session_id'
 and (not_after is null or not_after>clock_timestamp())
 on conflict(session_id) do update set last_activity_at=excluded.last_activity_at
 where app_sessions.revoked_at is null
 and app_sessions.last_activity_at+interval '30 minutes'>clock_timestamp();
 return private.app_session_state();
end $$;
revoke all on function private.touch_app_session() from public,anon,authenticated,service_role;
grant execute on function private.touch_app_session() to authenticated;
create function public.touch_app_session() returns jsonb language sql security invoker set search_path='' as $$select private.touch_app_session();$$;
revoke all on function public.touch_app_session() from public,anon,authenticated,service_role;
grant execute on function public.touch_app_session() to authenticated;
notify pgrst,'reload schema';
commit;
