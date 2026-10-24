import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migratedPostgres} from '../../../tests/helpers/postgres.mjs';

test('employees reopen their own completed tickets atomically with reasons, history and IT email',async()=>{
 const db=await migratedPostgres();
 const org=randomUUID(),employee=randomUUID(),other=randomUUID(),worker=randomUUID();
 const identity=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aal:'aal1'})]);await db.exec('set role authenticated');};
 try{
  await db.query("insert into public.organizations(id,name,slug) values($1,'Reopening','reopen-with-reason')",[org]);
  for(const [id,role,name] of [[employee,'end_user','Taylor'],[other,'end_user','Other'],[worker,'administrator','Alex']]){
   await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${id}@example.test`]);
   await db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[org,id,role]);
   await db.query('insert into public.profiles(organization_id,user_id,display_name) values($1,$2,$3)',[org,id,name]);
  }
  for(const status of ['resolved','closed']){
   await db.exec('reset role');
   const id=randomUUID(),token=randomUUID();
   await db.query("insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,status,title,description,priority) values($1,$2,$3,$4,$5,'Same issue','Original description','high')",[id,org,employee,worker,status]);
   await identity(other);
   await assert.rejects(db.query('select public.reopen_ticket($1,1,$2,$3)',[id,'Still failing',token]),{code:'42501'});
   await identity(employee);
   await assert.rejects(db.query("update public.tickets set status='open' where id=$1",[id]),{code:'42501'});
   await assert.rejects(db.query('select public.reopen_ticket($1,1,$2,$3)',[id,' \n ',token]),{code:'22023'});
   await assert.rejects(db.query('select public.reopen_ticket($1,99,$2,$3)',[id,'Still failing',token]),{code:'PT409'});
   const reason='The same printer still fails after the fix.';
   const result=(await db.query('select public.reopen_ticket($1,1,$2,$3) revision',[id,reason,token])).rows[0].revision;
   assert.equal(result,2);
   assert.equal((await db.query('select public.reopen_ticket($1,1,$2,$3) revision',[id,reason,token])).rows[0].revision,2);
   await assert.rejects(db.query('select public.reopen_ticket($1,1,$2,$3)',[id,'Different reason',token]),{code:'PT409'});
   await db.exec('reset role');
   const ticket=(await db.query('select * from public.tickets where id=$1',[id])).rows[0];
   assert.equal(ticket.status,'open');assert.equal(ticket.assigned_technician_id,worker);assert.equal(ticket.revision,2);
   assert.equal(ticket.resolved_at,null);assert.equal(ticket.closed_at,null);assert.equal(ticket.description,'Original description');
   const activity=(await db.query("select details from public.ticket_activity where ticket_id=$1 and action='status_changed'",[id])).rows;
   assert.equal(activity.length,1);assert.equal(activity[0].details.reason,reason);
   const notices=(await db.query("select * from public.notifications where ticket_id=$1 and kind='ticket_reopened'",[id])).rows;
   assert.deepEqual(notices.map(n=>n.recipient_id),[worker]);
   assert.equal((await db.query('select reopen_reason from private.notification_email_outbox where notification_id=$1',[notices[0].id])).rows[0].reopen_reason,reason);
  }
  await db.exec('reset role');
  const unassigned=randomUUID();
  await db.query("insert into public.tickets(id,organization_id,requester_id,status,title,description) values($1,$2,$3,'closed','Unassigned issue','Original')",[unassigned,org,employee]);
  await identity(employee);
  await db.query("select public.reopen_ticket($1,1,'Still failing after closure.',gen_random_uuid())",[unassigned]);
  await db.exec('reset role');
  const fallback=(await db.query("select recipient_id from public.notifications where ticket_id=$1 and kind='ticket_reopened'",[unassigned])).rows;
  assert.deepEqual(fallback.map(row=>row.recipient_id),[worker]);
  await db.exec('reset role');
  assert.equal((await db.query("select has_table_privilege('authenticated','private.ticket_reopen_receipts','insert') allowed")).rows[0].allowed,false);
  await db.query("select set_config('request.jwt.claims','{}',false)");
  const tap=await db.exec(await readFile('supabase/tests/database/employee_reopen.test.sql','utf8'));
  assert.ok(!JSON.stringify(tap).includes('not ok'),JSON.stringify(tap));
 }finally{await db.close();}
});
