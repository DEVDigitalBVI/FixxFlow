-- Test-only token issuer. Never deploy or use in application code.
create or replace function pg_temp.set_test_session(claims text, local_setting boolean) returns text
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=claims::jsonb; actor uuid; session uuid;
begin
 if payload->>'sub' is not null and not(payload ? 'session_id') then
  actor:=(payload->>'sub')::uuid;
  if exists(select 1 from auth.users where id=actor) then
   select id into session from auth.sessions where user_id=actor and (not_after is null or not_after>now()) limit 1;
   if session is null then
    session:=gen_random_uuid();
    insert into auth.sessions(id,user_id) values(session,actor);
   end if;
   payload:=payload||jsonb_build_object('session_id',session);
  end if;
 end if;
 return set_config('request.jwt.claims',payload::text,local_setting);
end $$;
