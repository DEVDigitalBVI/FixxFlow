import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {migratedPostgres} from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000401',other='20000000-0000-0000-0000-000000000402';
const admin='10000000-0000-0000-0000-000000000401',employee='10000000-0000-0000-0000-000000000404';
async function identity(db,id){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aal:'aal1'})]);await db.exec('set role authenticated');}
test('timezone migration preserves pilot days and enforces tenant, profile and report boundaries',async()=>{
 const legacy='20000000-0000-0000-0000-000000000999';
 const db=await migratedPostgres({beforeMigration:async(db,name)=>{if(name==='20261009170458_organization_and_personal_timezones.sql')await db.query("insert into public.organizations(id,name,slug) values($1,'Legacy pilot','legacy-pilot')",[legacy]);}});
 try{
  assert.equal((await db.query('select timezone from public.organizations where id=$1',[legacy])).rows[0].timezone,'America/Tortola');
  await db.exec(await readFile('tests/fixtures/domain-events.sql','utf8'));
  assert.equal((await db.query('select timezone from public.organizations where id=$1',[org])).rows[0].timezone,'UTC');
  await identity(db,employee);
  assert.equal((await db.query("update public.organizations set timezone='Asia/Tokyo' where id=$1 returning id",[org])).rows.length,0);
  await db.query("update public.profiles set timezone='Asia/Kathmandu' where organization_id=$1 and user_id=$2",[org,employee]);
  assert.equal((await db.query('select timezone from public.profiles where user_id=$1',[employee])).rows[0].timezone,'Asia/Kathmandu');
  await assert.rejects(()=>db.query('select public.operational_report($1)',[org]),/Staff access required/);
  await identity(db,admin);
  await assert.rejects(()=>db.query("update public.organizations set timezone='Bogus/Zone' where id=$1",[org]),/Invalid named timezone/);
  await db.query("update public.organizations set timezone='Asia/Tokyo' where id=$1",[org]);
  await db.exec('reset role');
  const ticket=(await db.query("insert into public.tickets(organization_id,requester_id,title,description,created_at,due_at) values($1,$2,'Timezone report','Boundary check',((date_trunc('day',now() at time zone 'UTC')-interval '2 days'+interval '30 minutes') at time zone 'UTC'),'2026-11-01T06:30:00Z') returning id,created_at",[org,employee])).rows[0];
  await identity(db,admin);
  const report=(await db.query('select public.operational_report($1) report',[org])).rows[0].report;
  const tokyoDay=(await db.query("select ($1::timestamptz at time zone 'Asia/Tokyo')::date::text as local_day",[ticket.created_at])).rows[0].local_day;
  assert.equal(report.daily.find(row=>row.day===tokyoDay).created,1);
  await db.query("update public.organizations set timezone='Pacific/Honolulu' where id=$1",[org]);
  const hawaii=(await db.query('select public.operational_report($1) report',[org])).rows[0].report;
  const hawaiiDay=(await db.query("select ($1::timestamptz at time zone 'Pacific/Honolulu')::date::text as local_day",[ticket.created_at])).rows[0].local_day;
  assert.notEqual(tokyoDay,hawaiiDay);assert.equal(hawaii.daily.find(row=>row.day===hawaiiDay).created,1);
  assert.equal((await db.query('select extract(epoch from due_at)::float8 as deadline from public.tickets where id=$1',[ticket.id])).rows[0].deadline,Date.parse('2026-11-01T06:30:00Z')/1000);
  assert.equal(report.timezone,'Asia/Tokyo');
  assert.equal(report.today,(await db.query("select (now() at time zone 'Asia/Tokyo')::date::text as local_day")).rows[0].local_day);
  assert.equal((await db.query("update public.organizations set timezone='UTC' where id=$1 returning id",[other])).rows.length,0);
  await db.query('update public.profiles set timezone=null where user_id=$1',[employee]);
  assert.equal((await db.query('select timezone from public.profiles where user_id=$1',[employee])).rows[0].timezone,null);
  await db.exec('reset role');
  const newcomer='10000000-0000-0000-0000-000000000998';
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'new-timezone@example.invalid',now())",[newcomer]);
  await db.exec('set role service_role');
  await assert.rejects(()=>db.query("select public.bootstrap_organization('New customer','new-timezone-customer','New Admin',$1,'Invalid/Zone')",[newcomer]),/Invalid named timezone/);
  assert.equal((await db.query("select id from public.organizations where slug='new-timezone-customer'")).rows.length,0);
  const created=(await db.query("select public.bootstrap_organization('New customer','new-timezone-customer','New Admin',$1,'Europe/London') as id",[newcomer])).rows[0].id;
  assert.equal((await db.query('select timezone from public.organizations where id=$1',[created])).rows[0].timezone,'Europe/London');
 }finally{await db.close();}
});
