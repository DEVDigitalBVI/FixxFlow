-- Plain SQL; fixtures and assertions roll back. Run against a migrated test database.
begin;
create function pg_temp.check_security(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Security assertion failed: %', message; end if; end;
$$;
insert into auth.users (id, email) values
 ('10000000-0000-0000-0000-000000000051', 'audit-admin@example.test'),
 ('10000000-0000-0000-0000-000000000052', 'audit-employee@example.test');
insert into public.organizations (id,name,slug) values
 ('20000000-0000-0000-0000-000000000051','Audit fixtures','audit-fixtures');
insert into public.organization_memberships (organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','administrator'),
 ('20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000052','end_user');
insert into auth.mfa_factors (id,user_id,factor_type,status,created_at,updated_at) values
 ('40000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','totp','verified',now(),now());
insert into public.tickets (id,organization_id,requester_id,title,description) values
 ('30000000-0000-0000-0000-000000000051','20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000052','Audit ticket','Fixture');

insert into storage.objects (bucket_id,name) values ('profile-photos',
 '20000000-0000-0000-0000-000000000051/10000000-0000-0000-0000-000000000051/audit.png');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000051","aal":"aal1","role":"authenticated"}',true);
select pg_temp.check_security(not private.has_required_assurance(),'enrolled aal1 denied');
select pg_temp.check_security((select count(*)=0 from storage.objects where name like '20000000-0000-0000-0000-000000000051/%'),'enrolled aal1 cannot read Storage');
select pg_temp.check_security((select count(*)=0 from public.tickets),'enrolled aal1 cannot read tickets');
select pg_temp.check_security((select count(*)=0 from public.organization_memberships),'enrolled aal1 cannot read memberships');
with changed as (update public.organization_memberships set role='technician'
 where user_id='10000000-0000-0000-0000-000000000052' returning *)
select pg_temp.check_security((select count(*)=0 from changed),'enrolled aal1 cannot mutate membership');
do $$ begin
  begin
    insert into public.ticket_messages (organization_id,ticket_id,author_id,body) values
      ('20000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','Blocked');
    raise exception 'aal1 insert unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000051","aal":"aal2","role":"authenticated"}',true);
select pg_temp.check_security(private.has_required_assurance(),'enrolled aal2 allowed');
select pg_temp.check_security((select count(*)=1 from storage.objects where name like '20000000-0000-0000-0000-000000000051/%'),'enrolled aal2 retains Storage access');
select pg_temp.check_security((select count(*)=1 from public.tickets where id='30000000-0000-0000-0000-000000000051'),'aal2 legitimate read');
insert into public.ticket_messages (organization_id,ticket_id,author_id,kind,body) values
 ('20000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','internal_note','Private note');
select pg_temp.check_security((select first_response_at is null from public.tickets where id='30000000-0000-0000-0000-000000000051'),'internal note does not complete response');
do $$ begin
  begin
    insert into public.ticket_messages (organization_id,ticket_id,author_id,body,created_at) values
      ('20000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','Forged','2000-01-01');
    raise exception 'Forged reply unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.ticket_messages (organization_id,ticket_id,author_id,body) values
 ('20000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','Public reply');
select pg_temp.check_security((select first_response_at=now() from public.tickets where id='30000000-0000-0000-0000-000000000051'),'server-observed first response');

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000052","aal":"aal1","role":"authenticated"}',true);
select pg_temp.check_security(private.has_required_assurance(),'unenrolled aal1 allowed');
select pg_temp.check_security((select count(*)=1 from public.ticket_messages where ticket_id='30000000-0000-0000-0000-000000000051'),'employee sees public reply only');
do $$ begin
  begin
    insert into public.tickets (organization_id,requester_id,title,description,created_at) values
      ('20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000052','Forged ticket','Fixture','2099-01-01');
    raise exception 'Forged creation unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.tickets (organization_id,requester_id,title,description) values
 ('20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000052','Legitimate ticket','Fixture');
select pg_temp.check_security((select created_at=now() and response_sla_due_at=now()+interval '4 hours'
 from public.tickets where title='Legitimate ticket'),'legitimate creation uses server time');

reset role;
select pg_temp.check_security((select count(*)=22 from pg_policies
 where policyname='require_enrolled_mfa' and permissive='RESTRICTIVE' and cmd='ALL'),
 'all 20 app tables plus Storage and Realtime have restrictive assurance policies');
select pg_temp.check_security(not has_column_privilege('authenticated','public.chat_messages','created_at','INSERT')
 and not has_column_privilege('authenticated','public.chat_conversations','created_at','INSERT')
 and not has_column_privilege('authenticated','public.tickets','first_response_at','INSERT')
 and not has_column_privilege('authenticated','public.tickets','response_sla_due_at','INSERT'),
 'all system-owned chronology and completion fields protected');
rollback;
