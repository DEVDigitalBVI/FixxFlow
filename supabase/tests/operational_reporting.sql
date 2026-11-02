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

-- Run against a database with an active administrator. All fixture writes roll back.
begin;
select pg_temp.set_test_session(jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.organization_memberships where role='administrator' and status='active' limit 1;
do $$
declare org uuid; actor uuid := auth.uid(); ticket uuid;
begin
  select organization_id into org from public.organization_memberships where user_id=actor and role='administrator' and status='active' limit 1;
  if org is null then raise exception 'An active administrator is required'; end if;
  -- Only run the numerical fixture against an empty tenant to keep assertions deterministic.
  if exists(select 1 from public.tickets where organization_id=org) then raise exception 'Use an empty test organization'; end if;
  insert into public.tickets(organization_id,requester_id,title,description,created_at,first_response_at)
  values(org,actor,'Reporting fixture one','Temporary reporting verification',now()-interval '2 hours',now()-interval '30 minutes') returning id into ticket;
  update public.tickets set status='resolved' where id=ticket;
  update public.tickets set status='open' where id=ticket;
  update public.tickets set status='resolved' where id=ticket;
  insert into public.tickets(organization_id,requester_id,title,description,created_at)
  values(org,actor,'Reporting fixture overdue','Temporary reporting verification',now()-interval '2 days');
end $$;
set local role authenticated;
do $$
declare org uuid; r jsonb;
begin
  select organization_id into org from public.organization_memberships where user_id=auth.uid() and role='administrator' and status='active' limit 1;
  r := public.operational_report(org);
  if (r#>>'{summary,resolved}')::int<>1 or (r#>>'{summary,open}')::int<>1 or (r#>>'{summary,overdue}')::int<>1 then raise exception 'Count assertion failed: %',r->'summary'; end if;
  if (r#>>'{summary,response}')::numeric<>90 or (r#>>'{summary,resolution}')::numeric<>120 then raise exception 'Duration assertion failed: %',r->'summary'; end if;
  if (select sum((v->>'reopened')::int) from jsonb_array_elements(r->'daily') v)<>1 then raise exception 'Reopened assertion failed'; end if;
  if jsonb_array_length(r->'daily')<>30 then raise exception 'Missing zero-filled dates'; end if;
  begin
    perform public.operational_report('00000000-0000-0000-0000-000000000000');
    raise exception 'Cross-organization access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
