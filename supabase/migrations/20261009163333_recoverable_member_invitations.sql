-- Private durable intent binds a pending Auth invitation to its workspace.
create table private.member_invitations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null unique check (email=lower(trim(email))),
  display_name text not null check (length(display_name) between 1 and 120),
  role public.app_role not null,
  invited_by uuid not null references auth.users(id),
  user_id uuid references auth.users(id),
  sending_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.member_invitations enable row level security;
revoke all on private.member_invitations from public,anon,authenticated,service_role;

-- These narrowly scoped privileged functions need Auth's email lookup. Only the
-- trusted server can call them; browser roles receive no EXECUTE privileges.
create function private.prepare_member_invitation(org uuid, token uuid, email text, display_name text, member_role public.app_role, actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.member_invitations%rowtype; invited auth.users%rowtype;
begin
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=actor and role='administrator' and status='active') then raise exception 'Active administrator required' using errcode='42501'; end if;
 if token is null or email is null or email<>lower(trim(email)) or length(email)>254 or position('@' in email)<2 or display_name is null or length(display_name) not between 1 and 120 or member_role is null then raise exception 'Invalid invitation'; end if;
 if exists(select 1 from private.member_invitations i where i.id=token and (i.organization_id<>org or i.email<>prepare_member_invitation.email)) then raise exception 'Invitation key already used' using errcode='PT409'; end if;
 insert into private.member_invitations(id,organization_id,email,display_name,role,invited_by)
 values(token,org,email,display_name,member_role,actor) on conflict do nothing;
 select * into invitation from private.member_invitations i where i.email=prepare_member_invitation.email for update;
 if not found then raise exception 'Invitation key already used' using errcode='PT409'; end if;
 if invitation.organization_id<>org then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if invitation.completed_at is not null then return jsonb_build_object('id',invitation.id,'userId',invitation.user_id,'completed',true); end if;
 if invitation.display_name<>display_name or invitation.role<>member_role then raise exception 'Retry the original invitation details' using errcode='PT409'; end if;
 select * into invited from auth.users u where lower(u.email)=prepare_member_invitation.email;
 if found then
  -- Existing workspace accounts must be managed through People, never reassigned.
  if invited.invited_at is null or exists(select 1 from public.organization_memberships where user_id=invited.id) then raise exception 'Account already exists' using errcode='PT409'; end if;
  update private.member_invitations set user_id=invited.id where id=invitation.id;
  return jsonb_build_object('id',invitation.id,'userId',invited.id,'completed',false);
 end if;
 if invitation.sending_at>clock_timestamp()-interval '2 minutes' then raise exception 'Invitation is being sent; retry in two minutes' using errcode='PT429'; end if;
 update private.member_invitations set sending_at=clock_timestamp() where id=invitation.id;
 return jsonb_build_object('id',invitation.id,'userId',null,'completed',false);
end $$;

create function private.complete_member_invitation(org uuid, token uuid, invited_user uuid, actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare invitation private.member_invitations%rowtype;
begin
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=actor and role='administrator' and status='active') then raise exception 'Active administrator required' using errcode='42501'; end if;
 select * into invitation from private.member_invitations where id=token and organization_id=org for update;
 if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if invitation.completed_at is not null then
  if invitation.user_id is distinct from invited_user then raise exception 'Invitation account mismatch' using errcode='42501'; end if;
  return;
 end if;
 if not exists(select 1 from auth.users where id=invited_user and lower(email)=invitation.email and invited_at is not null) then raise exception 'Invited account mismatch' using errcode='42501'; end if;
 perform public.register_invited_member(org,invited_user,invitation.role,invitation.display_name,invitation.email,actor);
 update private.member_invitations set user_id=invited_user,completed_at=clock_timestamp() where id=token;
end $$;
revoke all on function private.prepare_member_invitation(uuid,uuid,text,text,public.app_role,uuid) from public,anon,authenticated;
revoke all on function private.complete_member_invitation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.prepare_member_invitation(uuid,uuid,text,text,public.app_role,uuid) to service_role;
grant execute on function private.complete_member_invitation(uuid,uuid,uuid,uuid) to service_role;
create function public.prepare_member_invitation(org uuid, token uuid, email text, display_name text, member_role public.app_role, actor uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.prepare_member_invitation(org,token,email,display_name,member_role,actor);$$;
create function public.complete_member_invitation(org uuid, token uuid, invited_user uuid, actor uuid)
returns void language sql security invoker set search_path='' as $$select private.complete_member_invitation(org,token,invited_user,actor);$$;
revoke all on function public.prepare_member_invitation(uuid,uuid,text,text,public.app_role,uuid) from public,anon,authenticated;
revoke all on function public.complete_member_invitation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_member_invitation(uuid,uuid,text,text,public.app_role,uuid) to service_role;
grant execute on function public.complete_member_invitation(uuid,uuid,uuid,uuid) to service_role;
