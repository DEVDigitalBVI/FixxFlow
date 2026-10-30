-- Employee followers use the existing approved-update audience and delivery path.
-- This does not grant access to tickets, messages, attachments or internal notes.
alter table public.incident_stakeholder_groups
 add column is_follower_group boolean not null default false;
create unique index incident_one_active_follower_group
 on public.incident_stakeholder_groups(organization_id,ticket_id)
 where is_follower_group and not archived;

create function private.manage_incident_follower(org uuid,ticket uuid,person uuid,expected_revision bigint,operation text)
returns bigint language plpgsql security definer set search_path='' as $$
declare grp public.incident_stakeholder_groups; version bigint; target uuid;
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) or not private.has_required_assurance() then
  raise exception 'Follower access denied' using errcode='42501';
 end if;
 -- Same lock order as communication commands; serializes group creation and membership edits.
 perform 1 from public.ticket_incidents where organization_id=org and ticket_id=ticket for update;
 if not found then raise exception 'Declare an incident before adding employee followers' using errcode='42501'; end if;
 if operation is null or operation not in ('add','remove') or person is null then raise exception 'Invalid follower action'; end if;
 select * into grp from public.incident_stakeholder_groups
  where organization_id=org and ticket_id=ticket and is_follower_group and not archived;
 if operation='add' and exists(select 1 from public.incident_stakeholder_members where group_id=grp.id and user_id=person) then return grp.revision; end if;
 if operation='remove' and not exists(select 1 from public.incident_stakeholder_members where group_id=grp.id and user_id=person) then return coalesce(grp.revision,0); end if;
 if expected_revision is null or expected_revision<0 or coalesce(grp.revision,0)<>expected_revision then
  raise exception 'Followers changed; review the latest list' using errcode='PT409';
 end if;
 if grp.id is null then
  target:=pg_catalog.gen_random_uuid();
  version:=private.manage_incident_communication(org,ticket,target,0,'save_group','{"name":"Incident followers"}'::jsonb);
  update public.incident_stakeholder_groups set is_follower_group=true where id=target;
  select * into grp from public.incident_stakeholder_groups where id=target;
 end if;
 return private.manage_incident_communication(org,ticket,grp.id,grp.revision,
   case operation when 'add' then 'add_member' else 'remove_member' end,
   jsonb_build_object('user_id',person));
end $$;
revoke all on function private.manage_incident_follower(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.manage_incident_follower(uuid,uuid,uuid,bigint,text) to authenticated;
create function public.manage_incident_follower(org uuid,ticket uuid,person uuid,expected_revision bigint,operation text)
returns bigint language sql security invoker set search_path='' as $$
 select private.manage_incident_follower(org,ticket,person,expected_revision,operation)
$$;
revoke all on function public.manage_incident_follower(uuid,uuid,uuid,bigint,text) from public,anon;
grant execute on function public.manage_incident_follower(uuid,uuid,uuid,bigint,text) to authenticated;
