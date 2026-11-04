-- Application invitations last 72 hours independently of Auth's email OTP timer.
-- Tokens are hashed; only trusted server RPCs can read or change this state.
create table private.workspace_invitation_links (
 id uuid primary key,
 organization_id uuid not null,
 user_id uuid not null,
 email text not null,
 token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '72 hours'),
 sent_at timestamptz,
 provider_receipt text,
 claimed_at timestamptz,
 claim_token uuid,
 consumed_at timestamptz,
 revoked_at timestamptz,
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create index workspace_invitation_links_member_idx on private.workspace_invitation_links(organization_id,user_id,created_at desc);
alter table private.workspace_invitation_links enable row level security;
revoke all on private.workspace_invitation_links from public,anon,authenticated,service_role;

create function private.issue_workspace_invitation(org uuid,member uuid,actor uuid,token uuid,token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link private.workspace_invitation_links%rowtype; recipient auth.users%rowtype;
begin
 if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=actor and role='administrator' and status='active' and deleted_at is null) then raise exception 'Administrator required' using errcode='42501'; end if;
 perform 1 from public.organization_memberships where organization_id=org and user_id=member and status='active' and deleted_at is null for update;
 if not found then raise exception 'Member unavailable' using errcode='P0002'; end if;
 select * into strict recipient from auth.users where id=member;
 if recipient.email_confirmed_at is not null or recipient.invited_at is null then raise exception 'Account already set up; use password recovery' using errcode='PT409'; end if;
 select * into link from private.workspace_invitation_links where id=token;
 if found then
  if link.organization_id<>org or link.user_id<>member or link.token_hash is distinct from token_hash then raise exception 'Invitation mismatch' using errcode='42501'; end if;
  if link.revoked_at is not null or link.consumed_at is not null or link.expires_at<=clock_timestamp() then raise exception 'Use a new invitation' using errcode='PT410'; end if;
 else
  if exists(select 1 from private.workspace_invitation_links where organization_id=org and user_id=member and created_at>clock_timestamp()-interval '1 minute') then raise exception 'Wait before resending' using errcode='PT429'; end if;
  insert into private.workspace_invitation_links(id,organization_id,user_id,email,token_hash)
  values(token,org,member,recipient.email,token_hash) returning * into link;
 end if;
 return jsonb_build_object('id',link.id,'email',link.email,'expiresAt',link.expires_at,'sent',link.sent_at is not null);
end $$;

create function private.mark_workspace_invitation_sent(invitation uuid,hash text,receipt text) returns void
language plpgsql security definer set search_path='' as $$
declare link private.workspace_invitation_links%rowtype;
begin
 select * into link from private.workspace_invitation_links where id=invitation and token_hash=hash;
 if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 perform 1 from public.organization_memberships where organization_id=link.organization_id and user_id=link.user_id for update;
 select * into link from private.workspace_invitation_links where id=invitation and token_hash=hash for update;
 if not found or receipt is null or length(receipt)=0 then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if link.sent_at is not null then return; end if;
 if exists(select 1 from private.workspace_invitation_links where organization_id=link.organization_id and user_id=link.user_id and created_at>link.created_at and sent_at is not null) then
  update private.workspace_invitation_links set sent_at=clock_timestamp(),provider_receipt=receipt,revoked_at=clock_timestamp() where id=invitation;
  return;
 end if;
 update private.workspace_invitation_links set revoked_at=clock_timestamp() where organization_id=link.organization_id and user_id=link.user_id and created_at<link.created_at and consumed_at is null;
 update private.workspace_invitation_links set sent_at=clock_timestamp(),provider_receipt=receipt where id=invitation;
 insert into public.audit_events(organization_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(link.organization_id,'Workspace invitation','organization_memberships',link.user_id,'Invitation email','updated',jsonb_build_array(jsonb_build_object('field','invitation_expires_at','from',null,'to',link.expires_at)));
end $$;

create function private.claim_workspace_invitation(invitation uuid,hash text,claim uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link private.workspace_invitation_links%rowtype;
begin
 select * into link from private.workspace_invitation_links where id=invitation and token_hash=hash for update;
 if not found or claim is null or link.sent_at is null or link.expires_at<=clock_timestamp() or link.revoked_at is not null or link.consumed_at is not null then raise exception 'Invitation invalid or expired' using errcode='PT410'; end if;
 if not exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=link.organization_id and m.user_id=link.user_id and m.status='active' and m.deleted_at is null and u.email=link.email and u.email_confirmed_at is null and u.invited_at is not null) then raise exception 'Invitation unavailable; use sign in or password recovery' using errcode='PT410'; end if;
 if link.claimed_at>clock_timestamp()-interval '2 minutes' then raise exception 'Acceptance in progress; retry shortly' using errcode='PT429'; end if;
 update private.workspace_invitation_links set claimed_at=clock_timestamp(),claim_token=claim where id=invitation;
 return jsonb_build_object('userId',link.user_id,'email',link.email);
end $$;

create function private.finish_workspace_invitation(invitation uuid,claim uuid,success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.workspace_invitation_links set consumed_at=case when success then clock_timestamp() else null end,claimed_at=null,claim_token=null
 where id=invitation and claim_token=claim and consumed_at is null;
 if not found then raise exception 'Invitation claim unavailable' using errcode='42501'; end if;
end $$;

revoke all on function private.issue_workspace_invitation(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.issue_workspace_invitation(uuid,uuid,uuid,uuid,text) to service_role;
create function public.issue_workspace_invitation(org uuid,member uuid,actor uuid,token uuid,token_hash text) returns jsonb language sql security invoker set search_path='' as $$ select private.issue_workspace_invitation(org,member,actor,token,token_hash) $$;
revoke all on function public.issue_workspace_invitation(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_workspace_invitation(uuid,uuid,uuid,uuid,text) to service_role;

revoke all on function private.mark_workspace_invitation_sent(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.mark_workspace_invitation_sent(uuid,text,text) to service_role;
create function public.mark_workspace_invitation_sent(invitation uuid,hash text,receipt text) returns void language sql security invoker set search_path='' as $$ select private.mark_workspace_invitation_sent(invitation,hash,receipt) $$;
revoke all on function public.mark_workspace_invitation_sent(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_workspace_invitation_sent(uuid,text,text) to service_role;

revoke all on function private.claim_workspace_invitation(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.claim_workspace_invitation(uuid,text,uuid) to service_role;
create function public.claim_workspace_invitation(invitation uuid,hash text,claim uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.claim_workspace_invitation(invitation,hash,claim) $$;
revoke all on function public.claim_workspace_invitation(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_workspace_invitation(uuid,text,uuid) to service_role;

revoke all on function private.finish_workspace_invitation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.finish_workspace_invitation(uuid,uuid,boolean) to service_role;
create function public.finish_workspace_invitation(invitation uuid,claim uuid,success boolean) returns void language sql security invoker set search_path='' as $$ select private.finish_workspace_invitation(invitation,claim,success) $$;
revoke all on function public.finish_workspace_invitation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.finish_workspace_invitation(uuid,uuid,boolean) to service_role;
