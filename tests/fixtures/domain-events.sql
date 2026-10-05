-- Executed inside each test's rolled-back transaction.
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000401','events-admin-a@example.invalid'),
 ('10000000-0000-0000-0000-000000000402','events-admin-b@example.invalid'),
 ('10000000-0000-0000-0000-000000000403','events-worker@example.invalid'),
 ('10000000-0000-0000-0000-000000000404','events-requester@example.invalid');
insert into public.organizations(id,name,slug) values
 ('20000000-0000-0000-0000-000000000401','Events A','events-a'),
 ('20000000-0000-0000-0000-000000000402','Events B','events-b');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000401','administrator'),
 ('20000000-0000-0000-0000-000000000402','10000000-0000-0000-0000-000000000402','administrator'),
 ('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000403','technician'),
 ('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000404','end_user');
insert into public.departments(id,organization_id,name) values
 ('30000000-0000-0000-0000-000000000401','20000000-0000-0000-0000-000000000401','Engineering'),
 ('30000000-0000-0000-0000-000000000402','20000000-0000-0000-0000-000000000402','Other tenant');
insert into public.profiles(organization_id,user_id,display_name,department_id) values
 ('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000401','Event administrator',null),
 ('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000404','Requester','30000000-0000-0000-0000-000000000401');
insert into public.teams(id,organization_id,name) values
 ('40000000-0000-0000-0000-000000000401','20000000-0000-0000-0000-000000000401','Support');
insert into public.ticket_categories(id,organization_id,name,default_team_id) values
 ('50000000-0000-0000-0000-000000000401','20000000-0000-0000-0000-000000000401','Routed category','40000000-0000-0000-0000-000000000401');
insert into public.assets(id,organization_id,tag,name,kind,assigned_user_id) values
 ('60000000-0000-0000-0000-000000000401','20000000-0000-0000-0000-000000000401','EVENT-DEVICE','Requester laptop','computer','10000000-0000-0000-0000-000000000404');
