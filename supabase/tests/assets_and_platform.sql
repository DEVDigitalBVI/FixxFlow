-- Synthetic fixture accounts, sessions, MFA records and business data are all rolled back.
begin;
create temporary table fixture as select gen_random_uuid() staff,gen_random_uuid() employee,gen_random_uuid() outsider,gen_random_uuid() owner,gen_random_uuid() prospective,gen_random_uuid() org,gen_random_uuid() other_org,gen_random_uuid() asset,gen_random_uuid() other_asset,gen_random_uuid() session;
alter table fixture add column asset_count bigint;
update fixture set asset_count=(select coalesce(sum(count),0) from private.product_usage_counts where event='asset_viewed' and role='end_user');
grant select on fixture to authenticated;
insert into auth.users(id,email,email_confirmed_at) select staff,'asset-staff-'||staff||'@example.test',now() from fixture union all select employee,'asset-employee-'||employee||'@example.test',now() from fixture union all select outsider,'asset-outsider-'||outsider||'@example.test',now() from fixture union all select owner,'platform-owner-'||owner||'@example.test',now() from fixture union all select prospective,'platform-customer-'||prospective||'@example.test',now() from fixture;
insert into public.organizations(id,name,slug) select org,'Asset test organization','asset-test-'||org from fixture union all select other_org,'Other test organization','asset-test-'||other_org from fixture;
insert into public.organization_memberships(organization_id,user_id,role) select org,staff,'administrator'::public.app_role from fixture union all select org,employee,'end_user' from fixture union all select other_org,outsider,'administrator' from fixture;
insert into public.profiles(organization_id,user_id,display_name) select org,staff,'Test IT' from fixture union all select org,employee,'Test employee' from fixture union all select other_org,outsider,'Other IT' from fixture;
insert into private.platform_owners(user_id) select owner from fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select session,owner,now(),now() from fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',staff,'aal','aal2','session_id',gen_random_uuid())::text,true) from fixture;
set local role authenticated;
insert into public.assets(id,organization_id,tag,name,kind,status,assigned_user_id) select asset,org,' test-pc ','Test laptop','computer','in_use',employee from fixture;
do $$begin if not exists(select 1 from public.assets where tag='TEST-PC' and revision=1) then raise exception 'Tag normalization failed';end if;end$$;
update public.assets set model='Updated model' where id=(select asset from fixture) and revision=1;
do $$declare n integer;begin update public.assets set model='Stale edit' where id=(select asset from fixture) and revision=1;get diagnostics n=row_count;if n<>0 then raise exception 'Stale revision wrote data';end if;end$$;
do $$begin
 begin insert into public.assets(organization_id,tag,name,kind,assigned_user_id) select org,'BAD','Wrong assignee','computer',outsider from fixture;raise exception 'Cross organization assignee accepted';exception when foreign_key_violation or raise_exception then if SQLERRM='Cross organization assignee accepted' then raise;end if;end;
 begin update public.assets set organization_id=(select other_org from fixture) where id=(select asset from fixture);raise exception 'Tenant move accepted';exception when raise_exception then if SQLERRM='Tenant move accepted' then raise;end if;end;
 begin perform public.platform_overview();raise exception 'Tenant admin read platform';exception when insufficient_privilege then null;end;
end$$;
reset role;
insert into public.assets(id,organization_id,tag,name,kind) select other_asset,other_org,'OTHER','Other equipment','computer' from fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',employee,'aal','aal2','session_id',gen_random_uuid())::text,true) from fixture;
set local role authenticated;
do $$declare n integer; ticket uuid; before_count bigint;after_count bigint;begin
 if (select count(*) from public.assets)<>1 then raise exception 'Employee inventory visibility failed';end if;
 update public.assets set name='Forbidden' where id=(select asset from fixture);get diagnostics n=row_count;if n<>0 then raise exception 'Employee edited asset';end if;
 begin insert into public.assets(organization_id,tag,name,kind) select org,'EMPLOYEE','Forbidden','computer' from fixture;raise exception 'Employee created asset';exception when insufficient_privilege then null;end;
 ticket:=public.create_equipment_ticket((select org from fixture),(select asset from fixture),'Laptop screen issue','Screen flickers during use.');
 if not exists(select 1 from public.tickets where id=ticket and requester_id=(select employee from fixture))then raise exception 'Employee ticket missing';end if;
 begin perform public.create_equipment_ticket((select org from fixture),(select other_asset from fixture),'Wrong equipment','Must be denied.');raise exception 'Foreign asset accepted';exception when raise_exception then if SQLERRM='Foreign asset accepted' then raise;end if;end;
 -- Employees cannot forge associations through the table API.
 begin insert into public.ticket_assets(organization_id,ticket_id,asset_id) select org,ticket,other_asset from fixture;raise exception 'Employee linked arbitrary asset';exception when insufficient_privilege then null;end;
 insert into public.product_usage_preferences(user_id,enabled) select employee,true from fixture;
 perform public.record_product_usage('asset_viewed','assets',(select org from fixture),(select asset from fixture));
 perform public.record_product_usage('asset_viewed','assets',(select org from fixture),(select asset from fixture));
 perform public.record_product_usage('asset_viewed','assets',(select org from fixture),(select other_asset from fixture));
end$$;
reset role;
do $$begin
 if (select coalesce(sum(count),0) from private.product_usage_counts where event='asset_viewed' and role='end_user')<>(select asset_count+1 from fixture) then raise exception 'Asset view authorization or dedup failed';end if;
 if not exists(select 1 from public.ticket_assets where asset_id=(select asset from fixture))then raise exception 'Equipment request link missing';end if;
 if not exists(select 1 from public.audit_events where organization_id=(select org from fixture) and entity_type='assets' and action='updated')then raise exception 'Asset audit missing';end if;
end$$;
-- Owner verification, no tenant membership required.
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'aal','aal1','session_id',session)::text,true) from fixture;
set local role authenticated;
do $$begin if public.platform_access()<>'enroll' then raise exception 'Owner enrollment not required';end if;begin perform public.platform_overview();raise exception 'Unverified owner read data';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) select gen_random_uuid(),owner,'totp','verified',now(),now() from fixture;
set local role authenticated;
do $$begin if public.platform_access()<>'verify' then raise exception 'Owner challenge not required';end if;end$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'aal','aal2','session_id',session)::text,true) from fixture;
set local role authenticated;
do $$declare report jsonb; customer uuid;begin
 if public.platform_access()<>'ready' then raise exception 'Verified owner denied';end if;
 report:=public.platform_overview('Asset test',1,30);if jsonb_array_length(report->'organizations')<>1 then raise exception 'Customer search failed';end if;
 if exists(select 1 from public.assets) or exists(select 1 from public.tickets) then raise exception 'Owner bypassed tenant access';end if;
 customer:=public.manage_customer(null,'New fixture customer','fixture-'||(select prospective from fixture),'platform-customer-'||(select prospective from fixture)||'@example.test','Fixture customer admin');
 perform public.manage_customer(customer,'Renamed fixture customer');
 report:=public.platform_overview('Renamed fixture',1,30);if jsonb_array_length(report->'organizations')<>1 then raise exception 'Customer create/rename failed';end if;
 if jsonb_array_length(report->'audit')<2 then raise exception 'Owner audit missing';end if;
 begin insert into private.platform_owners(user_id) select employee from fixture;raise exception 'Owner self service elevation allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Live role revocation and missing session deny immediately even with an old JWT.
delete from private.platform_owners where user_id=(select owner from fixture);
set local role authenticated;
do $$begin if public.platform_access()<>'none' then raise exception 'Owner revocation stale';end if;begin perform public.platform_overview();raise exception 'Revoked owner allowed';exception when insufficient_privilege then null;end;end$$;
reset role;
rollback;
