import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000401',otherOrg='20000000-0000-0000-0000-000000000402';
const admin='10000000-0000-0000-0000-000000000401',employee='10000000-0000-0000-0000-000000000404';
const email='pilot-invite@example.invalid';
const prepare=async(db,token=randomUUID(),organization=org,actor=admin,name='Pilot Employee')=>(await db.query("select public.prepare_member_invitation($1,$2,$3,$4,'end_user',$5) result",[organization,token,email,name,actor])).rows[0].result;
const complete=async(db,token,user,actor=admin)=>db.query('select public.complete_member_invitation($1,$2,$3,$4)',[org,token,user,actor]);
async function denied(db,fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied; release savepoint denied');}}
test('invitation recovery binds identity, organization and immutable role to a durable intent',async t=>{
 const db=await migratedPostgres();
 const scenario=async(name,run)=>t.test(name,async()=>{await db.exec('begin');try{await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));await db.exec('set role service_role');await run();}finally{await db.exec('rollback; reset role');}});
 try {
  await scenario('lost Auth response is repaired with the same account and no new send lease',async()=>{
   const token=randomUUID(),first=await prepare(db,token);assert.equal(first.userId,null);assert.equal(first.completed,false);
   await denied(db,()=>prepare(db,token),/already being sent|being sent/);
   const user=randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id,email,invited_at)values($1,$2,now())',[user,email]);await db.exec('set role service_role');
   const retry=await prepare(db,token);assert.equal(retry.userId,user);
   await complete(db,retry.id,user);await complete(db,retry.id,user);
   assert.equal((await prepare(db,randomUUID())).completed,true);
   const member=(await db.query('select * from public.organization_memberships where user_id=$1',[user])).rows;assert.equal(member.length,1);assert.equal(member[0].role,'end_user');
  });
  await scenario('registration failure preserves the invitation for a later repair',async()=>{
   const token=randomUUID();await prepare(db,token);await db.exec('reset role');
   const user=randomUUID();await db.query('insert into auth.users(id,email,invited_at)values($1,$2,now())',[user,email]);await db.exec('set role service_role');
   await denied(db,()=>complete(db,token,employee),/mismatch/);
   assert.equal((await prepare(db,token)).userId,user);await complete(db,token,user);
  });
  await scenario('browser callers, wrong administrators, cross-tenant repair and changed roles are rejected',async()=>{
   await db.exec('set role authenticated');await denied(db,()=>prepare(db),/permission denied/);await db.exec('set role service_role');
   await denied(db,()=>prepare(db,randomUUID(),org,employee),/administrator/);
   const token=randomUUID();await prepare(db,token);
   await denied(db,()=>prepare(db,randomUUID(),otherOrg,'10000000-0000-0000-0000-000000000402'),/unavailable/);
   await denied(db,()=>prepare(db,token,org,admin,'Changed name'),/original invitation/);
   await denied(db,()=>db.query("select public.prepare_member_invitation($1,$2,$3,'Pilot Employee','administrator',$4)",[org,token,email,admin]),/original invitation/);
  });
  await scenario('an unassigned legacy invitation can be repaired but an existing workspace account cannot be moved',async()=>{
   const user=randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id,email,invited_at)values($1,$2,now())',[user,email]);await db.exec('set role service_role');
   const intent=await prepare(db);assert.equal(intent.userId,user);await complete(db,intent.id,user);
   await denied(db,()=>db.query("select public.prepare_member_invitation($1,$2,'events-requester@example.invalid','Existing member','end_user',$3)",[org,randomUUID(),admin]),/already exists/);
  });
 }finally{await db.close();}
});
