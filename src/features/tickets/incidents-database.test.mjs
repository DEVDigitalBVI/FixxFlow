import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',worker='10000000-0000-0000-0000-000000000403',employee='10000000-0000-0000-0000-000000000404',outsider='10000000-0000-0000-0000-000000000402';
const incident={severity:'major',business_impact:'Office connectivity unavailable',owner_id:worker,affected_services:['Internet'],affected_locations:['Main office']};
const payload={requester_id:employee,title:'Office connectivity outage',description:'Multiple teams cannot connect',priority:'normal',routing_mode:'automatic',incident};
const identity=async(db,id,aal='aal1')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aal})]);await db.exec('set role authenticated');};
async function denied(db,run,pattern){await db.exec('savepoint denied');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to savepoint denied; release savepoint denied');}}
test('incident coordination is atomic, tenant-scoped, staff-only and revision protected',async t=>{
 const db=await migratedPostgres();
 try{
  await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));await db.exec('begin');await identity(db,admin);
  const token=randomUUID();const submit=async(p=payload,k=token)=>(await db.query('select public.submit_incident_ticket($1,$2,$3) id',[org,k,p])).rows[0].id;
  const id=await submit();
  const ticket=(await db.query('select * from public.tickets where id=$1',[id])).rows[0];
  assert.equal(ticket.ticket_type,'incident');assert.equal(ticket.status,'new');assert.equal(ticket.priority,'normal');
  assert.equal((await db.query("select id from public.search_tickets($1,'connectivity') where ticket_type='incident'",[org])).rows[0].id,id);
  assert.equal(await submit(),id);
  assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,1);
  await t.test('stale edits fail and a receipt retry never restores old impact',async()=>{
   const edited={...incident,business_impact:'Restored for some teams'};
   const next=(await db.query('select public.save_ticket_incident($1,$2,$3,$4) rev',[org,id,ticket.revision,edited])).rows[0].rev;
   assert.ok(next>ticket.revision);
   await denied(db,()=>db.query('select public.save_ticket_incident($1,$2,$3,$4)',[org,id,ticket.revision,incident]),/changed/);
   assert.equal(await submit(),id);assert.equal((await db.query('select business_impact from public.ticket_incidents')).rows[0].business_impact,edited.business_impact);
   await denied(db,()=>submit({...payload,title:'Different incident'}),/different input/);
  });
  await t.test('bad owners, severity and names roll back the ticket and receipt',async()=>{
   for(const invalid of [{...incident,owner_id:employee},{...incident,owner_id:outsider},{...incident,severity:'urgent'},{...incident,affected_services:['x'.repeat(121)]},{...incident,affected_locations:Array(31).fill('Office')}]){
    await denied(db,()=>submit({...payload,incident:invalid},randomUUID()),/owner|constraint|characters/);
   }
   assert.equal((await db.query('select * from public.tickets')).rows.length,1);
   assert.equal((await db.query('select * from private.support_submissions')).rows.length,1);
  });
  await t.test('employees can read their ticket but cannot see coordination or forge classification',async()=>{
   await identity(db,employee);
   assert.equal((await db.query('select * from public.tickets where id=$1',[id])).rows.length,1);
   assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,0);
   await denied(db,()=>submit(payload,randomUUID()),/denied/);
   await denied(db,()=>db.query('select public.save_ticket_incident($1,$2,$3,$4)',[org,id,2,incident]),/denied/);
   await denied(db,()=>db.query("insert into public.tickets(organization_id,requester_id,title,description,ticket_type) values($1,$2,'Forged incident','Details','incident')",[org,employee]),/Declare incidents|permission denied/);
   await identity(db,outsider);
   assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,0);
   await denied(db,()=>submit(payload,randomUUID()),/denied/);
   await identity(db,admin);
  });
  await t.test('normal tickets can be declared as incidents and changes leave safe activity',async()=>{
   const normal=(await db.query('select public.submit_support_request($1,$2,$3,$4) id',[org,randomUUID(),'ticket',{...payload,incident:undefined}])).rows[0].id;
   const rev=(await db.query('select revision from public.tickets where id=$1',[normal])).rows[0].revision;
   await db.query('select public.save_ticket_incident($1,$2,$3,$4)',[org,normal,rev,incident]);
   const activity=(await db.query("select * from public.ticket_activity where ticket_id=$1 and action='incident_declared'",[normal])).rows;
   assert.equal(activity.length,1);assert.deepEqual(activity[0].details,{});
   assert.equal((await db.query('select ticket_type from public.tickets where id=$1',[normal])).rows[0].ticket_type,'incident');
  });
  await t.test('enrolled MFA is enforced for incident reads and writes',async()=>{
   await db.exec('reset role');
   await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[admin]);
   await identity(db,admin);
   assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,0);
   await denied(db,()=>submit(payload,randomUUID()),/denied/);
   await denied(db,()=>db.query('select public.save_ticket_incident($1,$2,$3,$4)',[org,id,3,incident]),/denied/);
   await identity(db,admin,'aal2');
   assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,2);
  });
 }finally{await db.exec('rollback');await db.close();}
});
