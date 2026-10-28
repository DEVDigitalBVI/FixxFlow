begin;
create table public.workspace_security_policies (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 require_mfa boolean not null default false,revision bigint not null default 1,
 updated_by uuid not null default auth.uid(),updated_at timestamptz not null default now(),
 foreign key(organization_id,updated_by) references public.organization_memberships(organization_id,user_id)
);
create index workspace_security_policy_actor_fk on public.workspace_security_policies(organization_id,updated_by);
alter table public.workspace_security_policies enable row level security;
revoke all on public.workspace_security_policies from public,anon,authenticated;
grant select on public.workspace_security_policies to authenticated;
grant insert(organization_id,require_mfa),update(require_mfa) on public.workspace_security_policies to authenticated;

-- Bootstrap is intentionally available before AAL2, and returns only the calling
-- account's required protection and enrollment status. It cannot reveal a tenant.
create function private.account_authentication_policy() returns table(mfa_required boolean,has_verified_factor boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 return query select exists(select 1 from public.workspace_security_policies p join public.organization_memberships m on m.organization_id=p.organization_id
   where m.user_id=auth.uid() and m.status='active' and p.require_mfa),
 exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified');
end $$;
revoke all on function private.account_authentication_policy() from public,anon,authenticated,service_role;
grant execute on function private.account_authentication_policy() to authenticated;
create function public.account_authentication_policy() returns table(mfa_required boolean,has_verified_factor boolean)
language sql security invoker set search_path='' as $$ select * from private.account_authentication_policy(); $$;
revoke all on function public.account_authentication_policy() from public,anon,service_role;
grant execute on function public.account_authentication_policy() to authenticated;

create or replace function private.has_required_assurance() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and case when exists(
   select 1 from public.organization_memberships m join public.workspace_security_policies p on p.organization_id=m.organization_id
   where m.user_id=auth.uid() and m.status='active' and p.require_mfa
 ) then coalesce(auth.jwt()->>'aal'='aal2',false) and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
 else coalesce(auth.jwt()->>'aal'='aal2',false) or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') end;
$$;
-- Role/member helpers are also used by definer RPCs. Centralizing assurance
-- here prevents those RPCs bypassing the table's restrictive MFA policies.
create or replace function private.is_active_organization_member(target_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_required_assurance() and exists(select 1 from public.organization_memberships m where m.organization_id=target_organization_id and m.user_id=auth.uid() and m.status='active');
$$;
create or replace function private.has_organization_role(target_organization_id uuid,allowed_roles public.app_role[]) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_required_assurance() and exists(select 1 from public.organization_memberships m where m.organization_id=target_organization_id and m.user_id=auth.uid() and m.status='active' and m.role=any(allowed_roles));
$$;
create or replace function private.can_work_tickets(target_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 -- Preserve the established no-human maintenance context; real user sessions
 -- always receive an explicit decision, including foreign or inactive members.
 select case when auth.uid() is null then null::boolean else private.has_organization_role(target_organization_id,array['technician','administrator']::public.app_role[]) end;
$$;
create function private.can_manage_workspace_security(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_organization_role(org,array['administrator']::public.app_role[]) and coalesce(auth.jwt()->>'aal'='aal2',false)
 and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified');
$$;
revoke all on function private.can_manage_workspace_security(uuid) from public,anon,service_role;
grant execute on function private.can_manage_workspace_security(uuid) to authenticated;
create policy security_policy_read on public.workspace_security_policies for select to authenticated
 using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]) and (select private.has_required_assurance()));
create policy security_policy_insert on public.workspace_security_policies for insert to authenticated
 with check(private.can_manage_workspace_security(organization_id));
create policy security_policy_update on public.workspace_security_policies for update to authenticated
 using(private.can_manage_workspace_security(organization_id)) with check(private.can_manage_workspace_security(organization_id));

create function private.prepare_workspace_security_policy() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_by:=auth.uid();new.updated_at:=now();
 if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
 return new;
end $$;
revoke all on function private.prepare_workspace_security_policy() from public,anon,authenticated,service_role;
create trigger workspace_security_policy_prepare before insert or update on public.workspace_security_policies for each row execute function private.prepare_workspace_security_policy();
create function public.save_workspace_security_policy(org uuid,expected_revision bigint,require_authenticator boolean) returns bigint
language plpgsql security invoker set search_path='' as $$
declare result bigint;
begin
 if private.can_manage_workspace_security(org) is not true then raise exception 'Verified workspace administrator required' using errcode='42501'; end if;
 if expected_revision is null or expected_revision<0 or require_authenticator is null then raise exception 'Invalid security policy' using errcode='22023'; end if;
 if expected_revision>0 and not exists(select 1 from public.workspace_security_policies where organization_id=org) then raise exception 'Security policy changed; reload before saving' using errcode='40001'; end if;
 insert into public.workspace_security_policies(organization_id,require_mfa) values(org,require_authenticator)
 on conflict(organization_id) do update set require_mfa=excluded.require_mfa where workspace_security_policies.revision=expected_revision returning revision into result;
 if result is null then raise exception 'Security policy changed; reload before saving' using errcode='40001'; end if;
 return result;
end $$;
revoke all on function public.save_workspace_security_policy(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.save_workspace_security_policy(uuid,bigint,boolean) to authenticated;
create function private.audit_workspace_security_policy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(organization_id,actor_id,actor_name,entity_type,entity_id,entity_label,action,changes)
 values(new.organization_id,auth.uid(),coalesce((select display_name from public.profiles where organization_id=new.organization_id and user_id=auth.uid()),'Administrator'),
 'workspace_security',new.organization_id,'Workspace authentication','updated',jsonb_build_array(jsonb_build_object('field','require_mfa','from',case when tg_op='INSERT' then false else old.require_mfa end,'to',new.require_mfa)));
 return new;
end $$;
revoke all on function private.audit_workspace_security_policy() from public,anon,authenticated,service_role;
create trigger workspace_security_policy_audit after insert or update on public.workspace_security_policies for each row execute function private.audit_workspace_security_policy();
commit;
