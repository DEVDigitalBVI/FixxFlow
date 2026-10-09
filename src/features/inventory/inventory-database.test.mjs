import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000401', otherOrg='20000000-0000-0000-0000-000000000402';
const admin='10000000-0000-0000-0000-000000000401', outsider='10000000-0000-0000-0000-000000000402', worker='10000000-0000-0000-0000-000000000403', employee='10000000-0000-0000-0000-000000000404';
const department='30000000-0000-0000-0000-000000000401', otherDepartment='30000000-0000-0000-0000-000000000402', location='70000000-0000-0000-0000-000000000401';
const asset='60000000-0000-0000-0000-000000000401';
async function identity(db,id=admin,role='authenticated') {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role,aal:'aal1'})]);
 await db.exec(`set role ${role}`);
}
async function command(db,name,payload,token=randomUUID(),organization=org) {
 return (await db.query('select public.inventory_command($1,$2,$3,$4) id',[organization,name,token,payload])).rows[0].id;
}
async function denied(db,fn,pattern) {
 await db.exec('savepoint deny');
 try { await assert.rejects(fn,pattern); } finally { await db.exec('rollback to savepoint deny; release savepoint deny'); }
}
const row=async(db,table,id)=>(await db.query(`select * from public.${table} where id=$1`,[id])).rows[0];
async function item(db,kind='consumable',stock=5) {
 await identity(db);
 const id=await command(db,'create',{name:kind==='equipment'?'Laptop':'Toner',kind,department,location});
 if(stock)await command(db,'receive',{id,quantity:stock});
 return id;
}
async function request(db,id,quantity=2,extra={},token=randomUUID()) {
 await identity(db,employee);
 return command(db,'request',{id,quantity,destination:'Engineering office',...extra},token);
}
test('inventory database authorization, stock and ticket integration',async t=>{
 const db=await migratedPostgres();
 async function scenario(name,run){ await t.test(name,async()=>{
  await db.exec('begin');
  try {
   await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));
   await db.query('insert into public.locations(id,organization_id,name) values($1,$2,$3)',[location,org,'Central store']);
   await identity(db);
   await command(db,'permissions',{id:admin,manager:true,departments:[department]});
   await command(db,'permissions',{id:worker,manager:true,departments:[department]});
   await command(db,'permissions',{id:employee,manager:false,departments:[department]});
   await run();
  }finally{await db.exec('rollback; reset role');}
 });}
 try {
 await scenario('RLS isolates organizations and capabilities; no direct stock or permission writes',async()=>{
  const id=await item(db);
  await identity(db,outsider);
  assert.equal((await db.query('select * from public.inventory_items')).rows.length,0);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:'Other tenant'}),/permission|denied/);
  await denied(db,()=>command(db,'receive',{id,quantity:1}),/permission|denied/);
  await denied(db,()=>db.query('update public.inventory_items set stock=100 where id=$1',[id]),/permission denied/);
  await denied(db,()=>command(db,'permissions',{id:employee,manager:true,departments:[]}),/denied|unavailable/);
  await identity(db,employee);
  await denied(db,()=>command(db,'permissions',{id:employee,manager:true,departments:[]}),/Only administrators/);
  await denied(db,()=>db.query('insert into public.inventory_managers values($1,$2)',[org,employee]),/permission denied/);
  await identity(db);
  await denied(db,()=>command(db,'create',{name:'Wrong dept',kind:'consumable',department:otherDepartment,location}),/active department/);
  await denied(db,()=>command(db,'permissions',{id:employee,manager:false,departments:[otherDepartment]}),/active department/);
 });
 await scenario('multiple department grants and requesters are independent of profile and roles; revocation blocks retries',async()=>{
  const second=randomUUID(); await db.exec('reset role'); await db.query('insert into public.departments(id,organization_id,name) values($1,$2,$3)',[second,org,'Finance']);
  await identity(db); await command(db,'permissions',{id:employee,manager:false,departments:[department,second]});
  assert.equal((await db.query('select * from public.inventory_requesters where user_id=$1',[employee])).rows.length,2);
  const id=await item(db); const key=randomUUID(); const r=await request(db,id,1,{},key);
  await identity(db); await command(db,'permissions',{id:employee,manager:false,departments:[]});
  await identity(db,employee);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:'Engineering office'},key),/permission/);
  await denied(db,()=>command(db,'cancel',{id:r}),/denied/);
  assert.equal((await db.query('select * from public.inventory_items')).rows.length,0);
  assert.equal((await row(db,'inventory_requests',r)).requester_id,employee);
 });
 await scenario('receipts and corrections are audited, idempotent, integer-only and never below reservations',async()=>{
  const id=await item(db,'consumable',0), token=randomUUID();
  await command(db,'receive',{id,quantity:5,note:'Delivery 42'},token);
  await command(db,'receive',{id,quantity:5,note:'Delivery 42'},token);
  assert.equal((await row(db,'inventory_items',id)).stock,5);
  await denied(db,()=>command(db,'receive',{id,quantity:6},token),/Retry key/);
  for(const quantity of [0,-1,1.5,null])await denied(db,()=>command(db,'receive',{id,quantity}),/whole|integer|invalid/);
  await denied(db,()=>command(db,'correct',{id,quantity:-1}),/reason/);
  await command(db,'correct',{id,quantity:-1,note:'Damaged cartridge'});
  const req=await request(db,id,3);await identity(db);await command(db,'approve',{id:req});
  await denied(db,()=>command(db,'correct',{id,quantity:-2,note:'Counted again'}),/below reservations/);
  assert.deepEqual([(await row(db,'inventory_items',id)).stock,(await row(db,'inventory_items',id)).reserved],[4,3]);
  const history=(await db.query('select * from public.inventory_movements where item_id=$1 order by created_at,id',[id])).rows;
  assert.equal(history.length,3);assert.ok(history.every(r=>r.actor_id===admin));assert.ok(history.some(r=>r.note==='Delivery 42'));
  await denied(db,()=>db.query('delete from public.inventory_movements where item_id=$1',[id]),/permission denied/);
 });
 await scenario('submission reserves nothing, competing approvals cannot overreserve, cancellation releases once',async()=>{
  const id=await item(db,'consumable',3), r1=await request(db,id,2), r2=await request(db,id,2);
  await identity(db); assert.equal((await row(db,'inventory_items',id)).reserved,0);
  await command(db,'approve',{id:r1}); await command(db,'approve',{id:r1});
  await denied(db,()=>command(db,'approve',{id:r2}),/Insufficient/);
  await identity(db,employee); await command(db,'cancel',{id:r1});await command(db,'cancel',{id:r1});
  await identity(db); await command(db,'approve',{id:r2});
  assert.equal((await row(db,'inventory_items',id)).reserved,2);
  assert.equal((await db.query("select * from public.inventory_movements where request_id=$1 and kind='released'",[r1])).rows.length,1);
 });
 await scenario('consumable issue confirms recipient, reduces stock and reservation once, preserves context and usage',async()=>{
  const id=await item(db),r=await request(db,id,2,{recipient:worker}); await identity(db);
  await command(db,'approve',{id:r});
  await denied(db,()=>command(db,'issue',{id:r,destination:'Substitute',recipient:worker}),/Confirm/);
  await command(db,'issue',{id:r,destination:'Engineering office',recipient:worker});
  await command(db,'issue',{id:r,destination:'Engineering office',recipient:worker});
  const i=await row(db,'inventory_items',id), req=await row(db,'inventory_requests',r);
  assert.deepEqual([i.stock,i.reserved,req.state],[3,0,'issued']);assert.equal(req.issued_by,admin);assert.ok(req.issued_at);
  assert.equal((await db.query("select * from public.inventory_movements where request_id=$1 and kind='issued'",[r])).rows.length,1);
  await db.exec('reset role');await db.query('update public.profiles set display_name=$1 where user_id=$2',['Renamed requester',employee]);
  await db.query('update public.departments set name=$1 where id=$2',['Renamed department',department]);
  await identity(db);assert.equal((await row(db,'inventory_requests',r)).context.requester,'Requester');assert.equal((await row(db,'inventory_requests',r)).context.department,'Engineering');
 });
 await scenario('equipment receipt uses existing assets, approval identifies units, issuance assigns and keeps ticket links',async()=>{
  await db.exec('reset role');await db.query("update public.assets set assigned_user_id=null,status='available' where id=$1",[asset]);
  await identity(db);const id=await item(db,'equipment',0);
  await command(db,'receive',{id,quantity:1,assets:[asset]});
  await identity(db,worker);await denied(db,()=>db.query("update public.assets set status='retired' where id=$1",[asset]),/through Inventory/);
  const r1=await request(db,id,1,{recipient:employee}), r2=await request(db,id,1);
  await identity(db);await denied(db,()=>command(db,'approve',{id:r1}),/specific equipment/);
  await command(db,'approve',{id:r1,assets:[asset]});
  await denied(db,()=>command(db,'approve',{id:r2,assets:[asset]}),/Insufficient|reserved/);
  await denied(db,()=>command(db,'issue',{id:r1,destination:'Engineering office',recipient:employee,assets:[]}),/exact reserved/);
  await command(db,'issue',{id:r1,destination:'Engineering office',recipient:employee,assets:[asset]});
  const a=await row(db,'assets',asset),req=await row(db,'inventory_requests',r1);
  assert.equal(a.assigned_user_id,employee);assert.equal(a.status,'in_use');
  assert.equal((await db.query('select * from public.ticket_assets where ticket_id=$1 and asset_id=$2',[req.ticket_id,asset])).rows.length,1);
  assert.equal((await db.query('select * from public.inventory_equipment where asset_id=$1',[asset])).rows[0].state,'issued');
 });
 await scenario('employee inventory manager can review and fulfill, without gaining unrelated support or internal notes',async()=>{
  const id=await item(db),r=await request(db,id,1);await identity(db);await command(db,'permissions',{id:employee,manager:true,departments:[department]});
  const support=(await db.query("insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Private support','Support only') returning id",[org,admin])).rows[0].id;
  await identity(db,employee);await command(db,'approve',{id:r});await command(db,'information',{id:r,note:'Confirm office'});
  assert.equal((await row(db,'inventory_items',id)).reserved,0);
  await command(db,'approve',{id:r});await command(db,'issue',{id:r,destination:'Engineering office'});
  assert.equal((await db.query('select * from public.tickets where id=$1',[support])).rows.length,0);
  await denied(db,async()=>db.query("insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','Secret')",[org,(await row(db,'inventory_requests',r)).ticket_id,employee]),/row-level security/);
 });
 await scenario('decline and questions require text and release reservations; final fulfillment cannot be revived',async()=>{
  const id=await item(db),r=await request(db,id);await identity(db);await command(db,'approve',{id:r});
  await denied(db,()=>command(db,'decline',{id:r}),/reason/);
  await command(db,'information',{id:r,note:'Which floor?'});assert.equal((await row(db,'inventory_items',id)).reserved,0);
  await command(db,'approve',{id:r});await command(db,'decline',{id:r,note:'No longer needed'});
  assert.equal((await row(db,'inventory_items',id)).reserved,0);
  await denied(db,()=>command(db,'approve',{id:r}),/cannot be approved/);
 });
 await scenario('closing releases approved holds and reopening never reserves or issues again',async()=>{
  const id=await item(db),r=await request(db,id);await identity(db);await command(db,'approve',{id:r});
  const req=await row(db,'inventory_requests',r);
  await db.query("update public.tickets set status='closed' where id=$1",[req.ticket_id]);
  assert.equal((await row(db,'inventory_requests',r)).state,'cancelled');assert.equal((await row(db,'inventory_items',id)).reserved,0);
  await identity(db,employee);await db.query("update public.tickets set status='open' where id=$1",[req.ticket_id]);
  assert.equal((await row(db,'inventory_requests',r)).state,'cancelled');
  await identity(db);await denied(db,()=>command(db,'issue',{id:r,destination:'Engineering office'}),/Approve and reserve/);
 });
 await scenario('reference pickers return scoped literal matches and reject revoked or ordinary support access',async()=>{
  await identity(db,employee);
  const people=await db.query("select * from public.inventory_choices($1,'inventory_people','Request')",[org]);assert.equal(people.rows.length,1);assert.equal(people.rows[0].id,employee);
  assert.equal((await db.query("select * from public.inventory_choices($1,'inventory_people','%')",[org])).rows.length,0);
  await denied(db,()=>db.query("select * from public.inventory_choices($1,'inventory_assets')",[org]),/manager permission/);
  await denied(db,()=>db.query("select * from public.inventory_choices($1,'inventory_people')",[otherOrg]),/denied/);
  await identity(db);await command(db,'permissions',{id:employee,manager:false,departments:[]});await identity(db,employee);
  await denied(db,()=>db.query("select * from public.inventory_choices($1,'inventory_people')",[org]),/denied/);
 });
 await scenario('request retries create one ticket and permissions, printer references, destinations stay organization scoped',async()=>{
  const id=await item(db),token=randomUUID();const r1=await request(db,id,1,{},token),r2=await request(db,id,1,{},token);assert.equal(r1,r2);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:'Elsewhere'},token),/Retry key/);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:'Office',recipient:outsider}),/Recipient/);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:'Office',printer:asset}),/printer/);
  await denied(db,()=>command(db,'request',{id,quantity:1,destination:''}),/destination/);
  assert.equal((await db.query('select * from public.inventory_requests')).rows.length,1);
 });
 }finally{await db.close();}
});
