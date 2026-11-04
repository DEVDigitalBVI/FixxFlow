begin;

-- Access enablement and invitation acceptance are separate facts. Return only
-- the directory label, never Auth credentials or private account fields.
create function private.member_account_statuses(org uuid, members uuid[])
returns table(user_id uuid, account_status text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.can_work_tickets(org),false) then
  raise exception 'Staff access and assurance required' using errcode='42501';
 end if;
 if members is null or cardinality(members) not between 1 and 25 or array_position(members,null) is not null then
  raise exception 'Choose between one and 25 members' using errcode='22023';
 end if;
 return query
 select m.user_id, case
  when m.status='inactive' then 'inactive'
  when u.invited_at is not null and (
   u.email_confirmed_at is null or (
    coalesce(u.encrypted_password,'')='' and
    not(coalesce(u.raw_app_meta_data->'providers','[]'::jsonb) ?| array['google','azure'])
   )
  ) then 'invited'
  else 'active'
 end
 from public.organization_memberships m join auth.users u on u.id=m.user_id
 where m.organization_id=org and m.user_id=any(members) and m.deleted_at is null;
end $$;
revoke all on function private.member_account_statuses(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.member_account_statuses(uuid,uuid[]) to authenticated;

create function public.member_account_statuses(org uuid, members uuid[])
returns table(user_id uuid, account_status text)
language sql stable security invoker set search_path='' as $$
 select * from private.member_account_statuses(org,members);
$$;
revoke all on function public.member_account_statuses(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.member_account_statuses(uuid,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
