import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {migratedPostgres} from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',owner='10000000-0000-0000-0000-000000000403',employee='10000000-0000-0000-0000-000000000404',outsider='10000000-0000-0000-0000-000000000402',stakeholder='10000000-0000-0000-0000-000000000405',author='10000000-0000-0000-0000-000000000406';
const identity=async(db,id,aal='aal1')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aal})]);await db.exec('set role authenticated');};
async function denied(db,run,pattern){await db.exec('savepoint denied');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to savepoint denied; release savepoint denied');}}
test('incident communication snapshots, approvals, scoped delivery, leases and reminders work end to end',async t=>{
 const db=await migratedPostgres();
 try{
 await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[stakeholder,'stakeholder@example.invalid',author,'author@example.invalid']);
 await db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user'),($1,$3,'technician')",[org,stakeholder,author]);
 await db.exec('begin');await identity(db,admin);
 const ticket=(await db.query('select public.submit_incident_ticket($1,$2,$3) id',[org,randomUUID(),{requester_id:employee,title:'Office outage',description:'Confidential internal troubleshooting',priority:'normal',routing_mode:'automatic',incident:{severity:'major',business_impact:'Secret internal impact',owner_id:owner,affected_services:[],affected_locations:[]}}])).rows[0].id;
 const change=async(op,target,revision,payload={},organization=org)=>(await db.query('select public.manage_incident_communication($1,$2,$3,$4,$5,$6) rev',[organization,ticket,target,revision,op,payload])).rows[0].rev;
 const group=randomUUID(),otherGroup=randomUUID(),draft=randomUUID();
 let g=await change('save_group',group,0,{name:'Leadership'});
 g=await change('add_member',group,g,{user_id:stakeholder});
 await change('save_group',otherGroup,0,{name:'Operations'});await change('add_member',otherGroup,1,{user_id:stakeholder});
 const payload={title:'Connectivity restoration update',body:'The provider is restoring service.\nWe will share progress here.',group_ids:[group,otherGroup],next_update_at:'2026-10-20T15:00:00Z'};
 await identity(db,author);let rev=await change('save_draft',draft,0,payload);
 await t.test('known foreign draft IDs cannot be overwritten through upsert',async()=>{
 const orgB='20000000-0000-0000-0000-000000000402',groupB=randomUUID(),draftB=randomUUID();
 await identity(db,outsider);
 const ticketB=(await db.query('select public.submit_incident_ticket($1,$2,$3) id',[orgB,randomUUID(),{requester_id:outsider,title:'Other tenant incident',description:'Other tenant details',priority:'normal',routing_mode:'automatic',incident:{severity:'minor',business_impact:'Other company impact',owner_id:outsider,affected_services:[],affected_locations:[]}}])).rows[0].id;
 const foreign=async(op,id,version,data)=>db.query('select public.manage_incident_communication($1,$2,$3,$4,$5,$6)',[orgB,ticketB,id,version,op,data]);
 await foreign('save_group',groupB,0,{name:'Other company'});await foreign('add_member',groupB,1,{user_id:outsider});
 await foreign('save_draft',draftB,0,{...payload,group_ids:[groupB],body:'Other company draft'});
 await identity(db,admin);await denied(db,()=>change('save_draft',draftB,0,payload),/unavailable/);
 await identity(db,outsider);assert.equal((await db.query('select body from public.incident_update_drafts where id=$1',[draftB])).rows[0].body,'Other company draft');
 await identity(db,author);
 });
 await t.test('saved audience is deduplicated and independent of later group edits',async()=>{
 const saved=(await db.query('select * from public.incident_update_drafts where id=$1',[draft])).rows[0];assert.deepEqual(saved.recipient_ids,[stakeholder]);assert.equal(saved.body,payload.body);
 await change('add_member',group,g,{user_id:employee});g++;
 assert.deepEqual((await db.query('select recipient_ids from public.incident_update_drafts where id=$1',[draft])).rows[0].recipient_ids,[stakeholder]);
 await denied(db,()=>change('publish',draft,rev),/Only the coordinator/);
 await denied(db,()=>change('add_member',group,g,{user_id:outsider}),/active company/);
 });
 await t.test('only owner/admin approves a reviewed revision, atomically and idempotently',async()=>{
 await identity(db,owner);await denied(db,()=>change('publish',draft,rev+1),/changed/);
 rev=await change('publish',draft,rev,{body:'Forged send-time message',recipient_ids:[outsider]});assert.equal(await change('publish',draft,rev-1),rev);
 assert.equal((await db.query('select * from public.incident_bulletins')).rows.length,1);
 const publication=(await db.query('select * from public.incident_bulletins')).rows[0];assert.equal(publication.approved_by,owner);assert.equal(publication.prepared_by,author);assert.equal(publication.recipient_count,1);assert.equal(publication.body,payload.body);
 await denied(db,()=>change('save_draft',draft,rev,payload),/cannot change/);
 await denied(db,()=>db.query("update public.incident_bulletins set body='Forged approval'"),/permission denied/);
 const summary=(await db.query('select * from public.incident_delivery_summary($1,$2,$3)',[org,ticket,[draft]])).rows[0];assert.equal(Number(summary.pending),1);
 });
 await t.test('selected employees see only published content and their notification, without ticket or roster access',async()=>{
 await identity(db,stakeholder);
 assert.equal((await db.query('select * from public.tickets where id=$1',[ticket])).rows.length,0);
 assert.equal((await db.query('select * from public.ticket_incidents')).rows.length,0);
 for(const table of ['incident_update_drafts','incident_stakeholder_groups','incident_stakeholder_members','incident_communication_plans'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0,table);
 assert.equal((await db.query('select * from public.incident_bulletins')).rows[0].body,payload.body);
 const notices=(await db.query("select * from public.notifications where kind='incident_update'")).rows;assert.equal(notices.length,1);assert.equal(notices[0].incident_bulletin_id,draft);
 await denied(db,()=>change('publish',draft,rev),/denied/);
 await denied(db,()=>db.query('select * from public.incident_delivery_summary($1,$2,$3)',[org,ticket,[draft]]),/denied/);
 for(const user of [employee,outsider]){await identity(db,user);assert.equal((await db.query('select * from public.incident_bulletins')).rows.length,0);assert.equal((await db.query("select * from public.notifications where kind='incident_update'")).rows.length,0);}
 });
 await t.test('dispatcher authorizes stakeholders, returns approved content, and retries retain notification identity',async()=>{
 await db.exec('reset role');await db.exec("update private.notification_email_outbox set available_at=now()-interval '1 minute'");await db.exec('set role service_role');
 const claimed=(await db.query('select * from public.claim_notification_emails(20)')).rows.find(n=>n.incident_bulletin_id===draft);assert.ok(claimed);assert.equal(claimed.approved_body,payload.body);assert.equal(claimed.title,(await db.query('select title from public.notifications where id=$1',[claimed.notification_id])).rows[0].title);assert.equal(claimed.recipient_email,'stakeholder@example.invalid');
 await db.query('select public.finish_notification_email($1,$2,$3,$4)',[claimed.notification_id,claimed.lease_token,null,'Retry']);
 await db.exec('reset role');await db.exec("update private.notification_email_outbox set available_at=now()-interval '1 minute'");await db.exec('set role service_role');
 const retry=(await db.query('select * from public.claim_notification_emails(20)')).rows.find(n=>n.incident_bulletin_id===draft);assert.equal(retry.notification_id,claimed.notification_id);assert.notEqual(retry.lease_token,claimed.lease_token);
 await db.query('select public.finish_notification_email($1,$2,$3)',[retry.notification_id,retry.lease_token,'provider-confirmation']);
 await identity(db,admin);assert.equal(Number((await db.query('select * from public.incident_delivery_summary($1,$2,$3)',[org,ticket,[draft]])).rows[0].sent),1);
 });
 await t.test('due reminders are deduplicated, reset only for a new schedule and exclude resolved incidents',async()=>{
 await identity(db,admin);const current=(await db.query('select * from public.incident_communication_plans')).rows[0];
 let planRev=await change('save_plan',ticket,current.revision,{owner_id:owner,next_update_at:'2020-01-01T00:00:00Z'});
 await db.exec('reset role');await db.exec('set role service_role');assert.equal((await db.query('select public.enqueue_incident_update_reminders() count')).rows[0].count,1);assert.equal((await db.query('select public.enqueue_incident_update_reminders() count')).rows[0].count,0);
 await identity(db,owner);assert.equal((await db.query("select * from public.notifications where kind='incident_update_due'")).rows.length,1);
 planRev=await change('save_plan',ticket,planRev,{owner_id:owner,next_update_at:'2020-01-01T00:00:00Z'});
 await db.exec('reset role');await db.exec('set role service_role');assert.equal((await db.query('select public.enqueue_incident_update_reminders() count')).rows[0].count,0);
 await identity(db,admin);await change('save_plan',ticket,planRev,{owner_id:owner,next_update_at:'2020-01-02T00:00:00Z'});await db.query("update public.tickets set status='resolved' where id=$1",[ticket]);
 await db.exec('reset role');await db.exec('set role service_role');assert.equal((await db.query('select public.enqueue_incident_update_reminders() count')).rows[0].count,0);
 });
 await t.test('MFA and current membership protect both shared and internal records',async()=>{
 await db.exec('reset role');await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[stakeholder]);await identity(db,stakeholder);
 assert.equal((await db.query('select * from public.incident_bulletins')).rows.length,0);assert.equal((await db.query("select * from public.notifications where kind='incident_update'")).rows.length,0);
 await identity(db,stakeholder,'aal2');assert.equal((await db.query('select * from public.incident_bulletins')).rows.length,1);
 await db.exec('reset role');await db.query("update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",[org,stakeholder]);await identity(db,stakeholder,'aal2');assert.equal((await db.query('select * from public.incident_bulletins')).rows.length,0);
 await db.exec('reset role');await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[admin]);await identity(db,admin);await denied(db,()=>change('save_group',randomUUID(),0,{name:'Blocked'}),/denied/);await identity(db,admin,'aal2');
 });
 }finally{await db.exec('rollback');await db.close();}
});
