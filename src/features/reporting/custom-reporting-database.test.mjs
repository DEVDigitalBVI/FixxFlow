import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const ids={admin:'10000000-0000-0000-0000-000000000401',otherAdmin:'10000000-0000-0000-0000-000000000402',worker:'10000000-0000-0000-0000-000000000403',employee:'10000000-0000-0000-0000-000000000404',org:'20000000-0000-0000-0000-000000000401',other:'20000000-0000-0000-0000-000000000402'};
async function identity(db,id=ids.admin,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role,aal:'aal1'})]);await db.exec(`set role ${role}`);}
const definition=(type='volume')=>({reportType:type,startDate:new Date(Date.now()-7*86400000).toISOString().slice(0,10),endDate:new Date().toISOString().slice(0,10),interval:'day',groupBy:type==='backlog'?'technician':'time',metrics:type==='volume'?['created','resolved','reopened']:['open','overdue'],filters:{statuses:[],priorities:[],categoryIds:[],subcategoryIds:[],teamIds:[],technicianIds:[],departmentIds:[],locationIds:[]}});
async function expectedError(_db,work,pattern){await assert.rejects(work,pattern);}

test('custom reports, saved visibility and scheduled delivery remain tenant and role scoped',async()=>{
 const db=await migratedPostgres();
 try{await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));
  const privileges=(await db.query("select has_function_privilege('authenticated','public.enqueue_scheduled_report_deliveries()','execute') enqueue,has_function_privilege('authenticated','public.claim_report_deliveries(integer,integer)','execute') claim,has_function_privilege('authenticated','public.finish_report_delivery(uuid,uuid,text,text,timestamptz,jsonb)','execute') finish,has_function_privilege('authenticated','public.report_delivery_history(uuid)','execute') history,has_function_privilege('service_role','public.enqueue_scheduled_report_deliveries()','execute') service_enqueue")).rows[0];
  assert.deepEqual(privileges,{enqueue:false,claim:false,finish:false,history:true,service_enqueue:true});
  await db.exec('reset role');
  const ticket=(await db.query("insert into public.tickets(organization_id,requester_id,title,description,category_id,created_at) values($1,$2,'Report ticket','Body',$3,now()-interval '1 day') returning id",[ids.org,ids.employee,'50000000-0000-0000-0000-000000000401'])).rows[0];
  await identity(db,ids.admin);await db.query("update public.tickets set status='resolved' where id=$1",[ticket.id]);
  const report=(await db.query('select public.custom_report($1,$2) report',[ids.org,definition()])).rows[0].report;
  assert.equal(report.reportType,'volume');assert.equal(report.timezone,'UTC');assert.equal(report.summary.find(item=>item.key==='created').value,1);assert.equal(report.summary.find(item=>item.key==='resolved').value,1);assert.ok(report.rows.length>=7);
  const backlog=(await db.query('select public.custom_report($1,$2) report',[ids.org,definition('backlog')])).rows[0].report;assert.equal(backlog.summary.find(item=>item.key==='open').value,0);
  await identity(db,ids.employee);await expectedError(db,()=>db.query('select public.custom_report($1,$2)',[ids.org,definition()]),/Staff access required/);
  await identity(db,ids.worker);const personal=(await db.query("insert into public.saved_reports(organization_id,owner_id,name,definition) values($1,$2,'My demand',$3) returning id",[ids.org,ids.worker,definition()])).rows[0].id;
  await expectedError(db,()=>db.query("insert into public.saved_reports(organization_id,owner_id,name,visibility,definition) values($1,$2,'Forged shared','shared',$3)",[ids.org,ids.worker,definition()]),/row-level security/);
  await identity(db,ids.admin);const shared=(await db.query("insert into public.saved_reports(organization_id,owner_id,name,visibility,definition) values($1,$2,'Executive view','shared',$3) returning id",[ids.org,ids.admin,definition()])).rows[0].id;
  await identity(db,ids.worker);assert.deepEqual((await db.query('select id from public.saved_reports order by name')).rows.map(row=>row.id).sort(),[personal,shared].sort());
  await identity(db,ids.otherAdmin);assert.equal((await db.query('select count(*)::int n from public.saved_reports')).rows[0].n,0);
  await expectedError(db,()=>db.query('select public.report_delivery_history($1)',[shared]),/Administrator access required/);
  await identity(db,ids.admin);const schedule=(await db.query("insert into public.report_schedules(organization_id,report_id,created_by,frequency,weekday,run_hour,timezone,format,recipient_emails,next_run_at) values($1,$2,$3,'weekly',1,8,'UTC','csv',array['owner@example.invalid'],now()) returning id,next_run_at",[ids.org,shared,ids.admin])).rows[0];assert.ok(Date.parse(schedule.next_run_at)>Date.now());
  const audits=(await db.query("select entity_type,changes from public.audit_events where entity_type in ('saved_reports','report_schedules') order by id")).rows;assert.ok(audits.some(item=>item.entity_type==='saved_reports'));assert.ok(audits.some(item=>item.entity_type==='report_schedules'));assert.doesNotMatch(JSON.stringify(audits),/owner@example|startDate|categoryIds/);assert.match(JSON.stringify(audits),/recipient_count/);
  await expectedError(db,()=>db.query("insert into public.report_schedules(organization_id,report_id,created_by,frequency,weekday,run_hour,timezone,recipient_emails,next_run_at) values($1,$2,$3,'weekly',1,8,'UTC',array['Bad Address'],now())",[ids.org,shared,ids.admin]),/Invalid report recipient/);
  await db.exec('reset role');await db.query("update public.report_schedules set next_run_at=now()-interval '1 minute' where id=$1",[schedule.id]);
  await identity(db,null,'service_role');assert.equal((await db.query('select public.enqueue_scheduled_report_deliveries() n')).rows[0].n,1);const [delivery]= (await db.query('select * from public.claim_report_deliveries(3,120)')).rows;assert.equal(delivery.report_id,shared);assert.equal(delivery.recipient_email,'owner@example.invalid');
  const serviceReport=(await db.query('select public.custom_report($1,$2) report',[ids.org,delivery.definition])).rows[0].report;assert.equal(serviceReport.summary.find(item=>item.key==='created').value,1);
  assert.equal((await db.query("select public.finish_report_delivery($1,$2,'provider-1',null,$3,$4) done",[delivery.delivery_id,delivery.lease_token,serviceReport.asOf,serviceReport.summary])).rows[0].done,true);
  await identity(db,ids.admin);const history=(await db.query('select * from public.report_delivery_history($1)',[shared])).rows;assert.equal(history[0].status,'sent');assert.equal(history[0].recipient_email,'owner@example.invalid');
 }finally{await db.close();}
});

