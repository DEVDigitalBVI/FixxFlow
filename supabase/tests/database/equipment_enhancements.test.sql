begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000841','equipment-admin-841@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000842','equipment-member-842@example.invalid',now());
insert into public.organizations(id,name,slug) values ('20000000-0000-0000-0000-000000000841','Equipment check','equipment-check-841');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000841','10000000-0000-0000-0000-000000000841','administrator'),
 ('20000000-0000-0000-0000-000000000841','10000000-0000-0000-0000-000000000842','end_user');
insert into public.departments(id,organization_id,name) values ('30000000-0000-0000-0000-000000000841','20000000-0000-0000-0000-000000000841','Office');
insert into public.locations(id,organization_id,name) values ('40000000-0000-0000-0000-000000000841','20000000-0000-0000-0000-000000000841','Store');
insert into public.assets(id,organization_id,tag,name,kind,assigned_user_id) values ('60000000-0000-0000-0000-000000000841','20000000-0000-0000-0000-000000000841','EQUIP-841','Laptop','computer','10000000-0000-0000-0000-000000000842');
insert into public.inventory_items(id,organization_id,name,kind,department_id,location_id,department_name,location_name,stock) values
 ('70000000-0000-0000-0000-000000000841','20000000-0000-0000-0000-000000000841','Toner','consumable','30000000-0000-0000-0000-000000000841','40000000-0000-0000-0000-000000000841','Office','Store',2);
insert into public.inventory_managers(organization_id,user_id) values ('20000000-0000-0000-0000-000000000841','10000000-0000-0000-0000-000000000842');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000841","role":"authenticated","aal":"aal1"}',true);
select extensions.lives_ok($$select public.import_asset_updates('20000000-0000-0000-0000-000000000841','[{"tag":"EQUIP-841","name":"Updated laptop","kind":"computer","status":"available","assigned_user_id":"10000000-0000-0000-0000-000000000841","end_of_life_on":"2030-01-01"}]','{"EQUIP-841":"1"}')$$,'staff updates by tag with preview revision');
select extensions.is((select id::text from public.assets where tag='EQUIP-841'),'60000000-0000-0000-0000-000000000841','asset identity is retained');
select extensions.is((select end_of_life_on::text from public.assets where tag='EQUIP-841'),'2030-01-01','end-of-life date is saved');
select extensions.is((select count(*)::int from public.asset_assignments where asset_id='60000000-0000-0000-0000-000000000841'),2,'reassignment preserves history');
select extensions.throws_ok($$select public.import_asset_updates('20000000-0000-0000-0000-000000000841','[{"tag":"EQUIP-841","name":"Stale laptop","kind":"computer","status":"available"}]','{"EQUIP-841":"1"}')$$,'40001',null,'stale preview rejected');
select extensions.throws_ok($$select public.set_inventory_reorder_threshold('20000000-0000-0000-0000-000000000841','70000000-0000-0000-0000-000000000841',2,null)$$,'42501',null,'administrator without inventory capability cannot set threshold');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000842","role":"authenticated","aal":"aal1"}',true);
select extensions.is((select count(*)::int from public.asset_assignments),0,'employee cannot read staff assignment history');
select extensions.throws_ok($$select public.import_asset_updates('20000000-0000-0000-0000-000000000841','[{"tag":"EQUIP-841","name":"Unauthorized","kind":"computer","status":"available"}]','{}')$$,'42501',null,'employee cannot import assets');
select extensions.lives_ok($$select public.set_inventory_reorder_threshold('20000000-0000-0000-0000-000000000841','70000000-0000-0000-0000-000000000841',2,null)$$,'employee-role inventory manager can configure alerts');
select extensions.is((select count(*)::int from public.notifications where inventory_item_id='70000000-0000-0000-0000-000000000841'),1,'current manager receives low-stock alert');
select public.set_inventory_reorder_threshold('20000000-0000-0000-0000-000000000841','70000000-0000-0000-0000-000000000841',2,2);
select extensions.is((select count(*)::int from public.notifications where inventory_item_id='70000000-0000-0000-0000-000000000841'),1,'unchanged setting does not duplicate alert');
select public.set_inventory_reorder_threshold('20000000-0000-0000-0000-000000000841','70000000-0000-0000-0000-000000000841',null,2);
reset role;
select extensions.is((select count(*)::int from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.inventory_item_id='70000000-0000-0000-0000-000000000841' and q.status='pending'),0,'disabling alerts cancels pending email');
delete from public.inventory_managers where organization_id='20000000-0000-0000-0000-000000000841';
set local role authenticated;
select extensions.is((select count(*)::int from public.notifications where inventory_item_id='70000000-0000-0000-0000-000000000841'),0,'revocation removes access to stock notices');
select extensions.throws_ok($$select public.process_equipment_reminders(100)$$,'42501',null,'only service worker may process reminders');
reset role;
select * from extensions.finish();
rollback;
