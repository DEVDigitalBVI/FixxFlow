import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { seed, ticket, createRule, identity, owner, ids, activate, service } from '../../../tests/helpers/automation-worker.mjs';
import { uuid } from '../../../tests/fixtures/automation.mjs';
async function read(db,kind,overrides={}) {
  const args={org:ids.org,kind,query:'',state:'all',trigger_type:'',resource:'',target:null,selected:[],page_number:1,...overrides};
  await db.exec('savepoint read_ui');
  try{const result=(await db.query('select public.read_automation_admin($1,$2,$3,$4,$5,$6,$7,$8,$9) value',Object.values(args))).rows[0].value;await db.exec('release savepoint read_ui');return result;}
  catch(error){await db.exec('rollback to savepoint read_ui;release savepoint read_ui');throw error;}
}
test('Stage 7 bounded admin read models on clean migrations',async t=>{
  const db=await migratedPostgres();
  try{
    await db.exec('begin');await seed(db);const target=await ticket(db),other=await ticket(db,ids.otherOrg);const rule=await createRule(db,{enabled:false});
    await identity(db);
    await t.test('list reports disabled rule, exact statistics and OFF processing',async()=>{
      const data=await read(db,'list');assert.equal(data.rows.length,1);assert.equal(data.rows[0].id,rule.id);assert.equal(data.rows[0].enabled,false);assert.equal(data.rows[0].run_count,0);assert.equal(data.rows[0].last_run,null);assert.equal(data.processingActive,false);
    });
    await t.test('search and filters run on scoped database data including literal punctuation',async()=>{
      assert.equal((await read(db,'list',{query:'route requests',state:'disabled'})).rows.length,1);
      for(const filters of [{query:'%'},{query:'foreign'},{state:'enabled'},{state:'archived'},{trigger_type:'ticket.resolved'}])assert.equal((await read(db,'list',filters)).rows.length,0);
    });
    await t.test('pickers and selected-label reads never disclose another organization',async()=>{
      assert.equal((await read(db,'choices',{resource:'active_ticket_workers',selected:[ids.worker,ids.otherAdmin]})).rows.length,1);
      for(const resource of ['teams','ticket_categories','ticket_subcategories','departments','locations','organization_memberships','tickets'])assert.ok(Array.isArray((await read(db,'choices',{resource})).rows));
      assert.equal((await read(db,'choices',{resource:'tickets',selected:[other.id]})).rows.length,0);
    });
    await t.test('event choices are ticket scoped, bounded metadata with no snapshots',async()=>{
      const events=(await read(db,'events',{target:target.id})).rows;assert.equal(events.length,1);assert.deepEqual(Object.keys(events[0]).sort(),['entity_version','event_type','id','occurred_at']);
      await assert.rejects(read(db,'events',{target:other.id}),e=>e.code==='P0002');
      await assert.rejects(read(db,'list',{org:ids.otherOrg}),e=>e.code==='42501');
    });
    await t.test('execution statistics use real persisted executions and processing remains independently controlled',async()=>{
      const runningRule=await createRule(db);await activate(db);const eventTicket=await ticket(db);await service(db);
      const delivery=(await db.query('select * from public.claim_automation_events(5,120)')).rows.find(row=>row.event.entityId===eventTicket.id);
      await db.query('select public.begin_automation_execution($1,$2,$3,$4)',[delivery.delivery_id,delivery.lease_token,runningRule.id,runningRule.version]);
      await owner(db);await db.query('select private.set_automation_processing(false)');await identity(db);
      const data=await read(db,'list');const result=data.rows.find(row=>row.id===runningRule.id);assert.equal(result.run_count,1);assert.equal(result.last_run.status,'running');assert.equal(data.processingActive,false);
    });
    await t.test('technician, end user, service, anon and insufficient MFA are denied',async()=>{
      for(const [role,actor] of [['authenticated',ids.worker],['authenticated',ids.employee],['service_role',ids.admin],['anon',ids.admin]]){await identity(db,role,actor);await assert.rejects(read(db,'list'),e=>e.code==='42501');}
      await owner(db);await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[ids.admin]);
      await identity(db);await assert.rejects(read(db,'list'),e=>e.code==='42501');
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.admin,role:'authenticated',aal:'aal2'})]);assert.equal((await read(db,'list')).rows.length,2);
    });
    await t.test('bounded input rejects invalid resource and pagination',async()=>{
      for(const args of [{page_number:0},{page_number:100001},{selected:Array(101).fill(uuid(1))}])await assert.rejects(read(db,'list',args),e=>e.code==='22023');
      await assert.rejects(read(db,'choices',{resource:'auth.users'}),e=>e.code==='22023');
    });
    await t.test('list and picker pages are bounded and deterministic',async()=>{
      // Owner-only fixture creation; normal requests still exercise auth/RLS RPCs.
      await owner(db);await db.query('delete from auth.mfa_factors where user_id=$1',[ids.admin]);
      for(let i=0;i<52;i++)await createRule(db,{enabled:false});await identity(db);
      const first=await read(db,'list');const second=await read(db,'list',{page_number:2});
      assert.equal(first.rows.length,51);assert.equal(second.rows.length,4);assert.equal(new Set([...first.rows.slice(0,50),...second.rows].map(row=>row.id)).size,54);
    });
    await db.exec('rollback');
  }finally{await db.close();}
});
