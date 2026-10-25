-- Preserve the requester's original impact independently of staff priority.
-- Nullable for historical tickets, chat, inventory, and staff-created requests.
alter table public.tickets add column reported_impact text
  check (reported_impact in ('minor_inconvenience','work_blocked','team_affected','operations_stopped'));
grant insert (reported_impact) on public.tickets to authenticated;
-- No UPDATE grant: the original report is retained when IT changes priority.

create function private.create_equipment_ticket(org uuid,asset uuid,subject text,body text,category uuid, impact text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; equipment public.assets%rowtype;
begin
 if auth.uid() is null or not private.is_active_organization_member(org) or not private.has_required_assurance() then raise exception 'Access denied' using errcode='42501'; end if;
 select * into equipment from public.assets where organization_id=org and id=asset and assigned_user_id=auth.uid() for share;
 if not found then raise exception 'Equipment not assigned to you'; end if;
 if length(trim(subject)) not between 3 and 180 or length(trim(body)) not between 1 and 20000 then raise exception 'Invalid request'; end if;
 if category is not null and not exists(select 1 from public.ticket_categories where organization_id=org and id=category and is_active) then raise exception 'Invalid category'; end if;
 insert into public.tickets(organization_id,requester_id,title,description,category_id,location_id,reported_impact) values(org,auth.uid(),trim(subject),trim(body),category,equipment.location_id,impact) returning id into result;
 insert into public.ticket_assets(organization_id,ticket_id,asset_id) values(org,result,asset);
 return result;
end $$;
revoke all on function private.create_equipment_ticket(uuid,uuid,text,text,uuid,text) from public,anon;
grant execute on function private.create_equipment_ticket(uuid,uuid,text,text,uuid,text) to authenticated;

create or replace function public.submit_support_request(org uuid, token uuid, kind text, payload jsonb)
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
    result:=private.create_equipment_ticket(org,(payload->>'asset')::uuid,payload->>'title',payload->>'description',(payload->>'category_id')::uuid,payload->>'reported_impact');
  else
    insert into public.tickets(organization_id,requester_id,title,description,priority,routing_mode,team_id,category_id,subcategory_id,location_id,assigned_technician_id,due_at,reported_impact)
    values(org,(payload->>'requester_id')::uuid,payload->>'title',payload->>'description',(payload->>'priority')::public.ticket_priority,
      payload->>'routing_mode',(payload->>'team_id')::uuid,(payload->>'category_id')::uuid,(payload->>'subcategory_id')::uuid,
      (payload->>'location_id')::uuid,(payload->>'assigned_technician_id')::uuid,(payload->>'due_at')::timestamptz,payload->>'reported_impact')
    returning id into result;
  end if;
  update private.support_submissions s set result_id=result
    where s.organization_id=org and s.actor_id=actor and s.token=submit_support_request.token;
  return result;
end $$;
revoke all on function public.submit_support_request(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.submit_support_request(uuid,uuid,text,jsonb) to authenticated;
