begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000891','mfa-admin-891@example.invalid'),
 ('10000000-0000-0000-0000-000000000892','mfa-employee-892@example.invalid'),
 ('10000000-0000-0000-0000-000000000893','mfa-foreign-893@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000891','MFA check A','mfa-a-891'),
 ('20000000-0000-0000-0000-000000000892','MFA check B','mfa-b-892');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000891','10000000-0000-0000-0000-000000000891','administrator'),
 ('20000000-0000-0000-0000-000000000891','10000000-0000-0000-0000-000000000892','end_user'),
 ('20000000-0000-0000-0000-000000000892','10000000-0000-0000-0000-000000000893','administrator');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000891","role":"authenticated","aal":"aal1"}',true);
insert into public.tickets(id,organization_id,requester_id,title,description) values
 ('30000000-0000-0000-0000-000000000891','20000000-0000-0000-0000-000000000891','10000000-0000-0000-0000-000000000892','MFA fixture','Request');
select extensions.throws_ok($$select public.save_workspace_security_policy('20000000-0000-0000-0000-000000000891',0,true)$$,'42501','Verified workspace administrator required','administrator must first verify MFA');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values ('40000000-0000-0000-0000-000000000891','10000000-0000-0000-0000-000000000891','totp','verified',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000891","role":"authenticated","aal":"aal2"}',true);
select extensions.is(public.save_workspace_security_policy('20000000-0000-0000-0000-000000000891',0,true),1::bigint,'verified administrator enables workspace MFA');
select extensions.throws_ok($$select public.save_workspace_security_policy('20000000-0000-0000-0000-000000000891',0,false)$$,'40001','Security policy changed; reload before saving','stale policy rejected');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000892","role":"authenticated","aal":"aal1"}',true);
select extensions.ok((select mfa_required and not has_verified_factor from public.account_authentication_policy()),'self-only bootstrap available before enrollment');
select extensions.is((select count(*)::int from public.tickets),0,'required AAL1 session cannot read tickets');
select extensions.ok(not private.is_active_organization_member('20000000-0000-0000-0000-000000000891'),'definer RPC member helper also denies under-protected session');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values ('40000000-0000-0000-0000-000000000892','10000000-0000-0000-0000-000000000892','totp','verified',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000892","role":"authenticated","aal":"aal2"}',true);
select extensions.is((select count(*)::int from public.tickets),1,'verified employee regains only own permitted ticket');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000893","role":"authenticated","aal":"aal1"}',true);
select extensions.ok((select not mfa_required from public.account_authentication_policy()),'other organization unaffected');
select extensions.is((select count(*)::int from public.workspace_security_policies),0,'foreign policy cannot be read');
reset role;
delete from auth.mfa_factors where id='40000000-0000-0000-0000-000000000891';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000891","role":"authenticated","aal":"aal2"}',true);
select extensions.ok(not private.has_required_assurance(),'removing last factor blocks even an old AAL2 token');
select extensions.throws_ok($$select public.save_workspace_security_policy('20000000-0000-0000-0000-000000000891',1,false)$$,'42501','Verified workspace administrator required','old token cannot weaken policy');
reset role;
select extensions.is((select count(*)::int from public.audit_events where organization_id='20000000-0000-0000-0000-000000000891' and entity_type='workspace_security'),1,'policy change audited');
select * from extensions.finish();
rollback;
