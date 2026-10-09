-- A receipt and its ticket/chat commit together. The row lock serializes retries.
-- Keep writes SECURITY INVOKER so all existing ticket/chat RLS and triggers apply.
create table private.support_submissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null,
  fingerprint text not null,
  result_id uuid,
  primary key (organization_id, actor_id, token)
);
alter table private.support_submissions enable row level security;
revoke all on private.support_submissions from public, anon, authenticated;
grant select, insert on private.support_submissions to authenticated;
grant update (result_id) on private.support_submissions to authenticated;
create policy "Members own their support submission receipts" on private.support_submissions
  for all to authenticated
  using (actor_id = (select auth.uid()) and private.is_active_organization_member(organization_id) and private.has_required_assurance())
  with check (actor_id = (select auth.uid()) and private.is_active_organization_member(organization_id) and private.has_required_assurance());

create function public.submit_support_request(org uuid, token uuid, kind text, payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
<<submission>>
declare
  actor uuid := auth.uid();
  fingerprint text := encode(sha256(convert_to(jsonb_build_object('kind',kind,'input',payload)::text,'UTF8')),'hex');
  previous private.support_submissions%rowtype;
  result uuid;
begin
  if actor is null or not private.is_active_organization_member(org) or not private.has_required_assurance() then
    raise exception 'Support access denied' using errcode='42501';
  end if;
  if token is null or payload is null or jsonb_typeof(payload)<>'object' or kind not in ('ticket','equipment','chat') or kind is null then
    raise exception 'Invalid support submission';
  end if;
  insert into private.support_submissions(organization_id,actor_id,token,fingerprint)
    values(org,actor,token,fingerprint) on conflict do nothing;
  select * into previous from private.support_submissions s
    where s.organization_id=org and s.actor_id=actor and s.token=submit_support_request.token for update;
  if previous.fingerprint<>fingerprint then
    raise exception 'Submission already saved with different input' using errcode='PT409';
  end if;
  if previous.result_id is not null then return previous.result_id; end if;
  if kind='chat' then
    result:=public.start_support_chat(org,payload->>'topic',payload->>'message');
  elsif kind='equipment' then
    result:=public.create_equipment_ticket(org,(payload->>'asset')::uuid,payload->>'title',payload->>'description',(payload->>'category_id')::uuid);
  else
    insert into public.tickets(organization_id,requester_id,title,description,priority,routing_mode,team_id,category_id,subcategory_id,location_id,assigned_technician_id,due_at)
    values(org,(payload->>'requester_id')::uuid,payload->>'title',payload->>'description',(payload->>'priority')::public.ticket_priority,
      payload->>'routing_mode',(payload->>'team_id')::uuid,(payload->>'category_id')::uuid,(payload->>'subcategory_id')::uuid,
      (payload->>'location_id')::uuid,(payload->>'assigned_technician_id')::uuid,(payload->>'due_at')::timestamptz)
    returning id into result;
  end if;
  update private.support_submissions s set result_id=result
    where s.organization_id=org and s.actor_id=actor and s.token=submit_support_request.token;
  return result;
end $$;
revoke all on function public.submit_support_request(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.submit_support_request(uuid,uuid,text,jsonb) to authenticated;
