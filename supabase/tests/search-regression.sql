begin;
create function pg_temp.check_search(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Search assertion failed: %',message; end if; end $$;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000071','search-worker@example.test'),
 ('10000000-0000-0000-0000-000000000072','search-employee@example.test'),
 ('10000000-0000-0000-0000-000000000073','search-outsider@example.test');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000071','Search fixtures','search-fixtures'),
 ('20000000-0000-0000-0000-000000000072','Other search fixtures','other-search-fixtures');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000071','technician'),
 ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000072','end_user'),
 ('20000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000073','end_user');
insert into public.profiles(organization_id,user_id,display_name) values
 ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000071','Morgan Technician'),
 ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000072','Jordan Requester');
insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,title,description,status) values
 ('30000000-0000-0000-0000-000000000071','20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000071','VPN problem','Error 809 happens at home','resolved'),
 ('30000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000072',null,'Connection issue','No title keywords','open'),
 ('30000000-0000-0000-0000-000000000073','20000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000073',null,'VPN error 809','Other organization','open');
insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values
 ('20000000-0000-0000-0000-000000000071','30000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000071','reply','VPN error 809 solved by changing firewall settings'),
 ('20000000-0000-0000-0000-000000000071','30000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000071','reply','VPN error 809 follow-up'),
 ('20000000-0000-0000-0000-000000000071','30000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000071','internal_note','confidentialneedle');
update public.tickets set category_id=(select id from public.ticket_categories where organization_id='20000000-0000-0000-0000-000000000071' and name='Network') where id='30000000-0000-0000-0000-000000000071';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000071","aal":"aal1"}',true);
select pg_temp.check_search((select count(*)=2 from public.search_tickets('20000000-0000-0000-0000-000000000071','VPN error 809')),'description and message matches; resolved included; no duplicates');
select pg_temp.check_search((select count(*)=2 from public.search_tickets('20000000-0000-0000-0000-000000000071','809')),'bare numeric error code searchable');
select pg_temp.check_search((select count(*)=1 from public.search_tickets('20000000-0000-0000-0000-000000000071','confidentialneedle')),'staff can find internal notes');
select pg_temp.check_search((select count(*)=1 from public.search_tickets('20000000-0000-0000-0000-000000000071','Morgan Technician')),'technician searchable');
select pg_temp.check_search((select count(*)=2 from public.search_tickets('20000000-0000-0000-0000-000000000071','Jordan Requester')),'requester searchable');
select pg_temp.check_search((select count(*)=1 from public.search_tickets('20000000-0000-0000-0000-000000000071','Network')),'category searchable');
select pg_temp.check_search((select count(*)=1 from public.search_tickets('20000000-0000-0000-0000-000000000071',(select '#'||ticket_number from public.tickets where id='30000000-0000-0000-0000-000000000071'))),'exact ticket reference');
select pg_temp.check_search((select count(*)=0 from public.search_tickets('20000000-0000-0000-0000-000000000072','VPN')),'organization argument cannot bypass RLS');
select pg_temp.check_search((select count(*)=0 from public.search_tickets('20000000-0000-0000-0000-000000000071','%_(),')),'punctuation safe');
select pg_temp.check_search((select count(*)=0 from public.search_tickets('20000000-0000-0000-0000-000000000071',repeat('9',200))),'oversized number safe');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000072","aal":"aal1"}',true);
select pg_temp.check_search((select count(*)=0 from public.search_tickets('20000000-0000-0000-0000-000000000071','confidentialneedle')),'employee cannot infer internal note through search');
select pg_temp.check_search((select count(*)=2 from public.search_tickets('20000000-0000-0000-0000-000000000071','VPN error 809')),'employee public content searchable');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'10000000-0000-0000-0000-000000000072','totp','verified',now(),now());
set local role authenticated;
select pg_temp.check_search((select count(*)=0 from public.search_tickets('20000000-0000-0000-0000-000000000071','VPN')),'MFA assurance required');
reset role;
rollback;
