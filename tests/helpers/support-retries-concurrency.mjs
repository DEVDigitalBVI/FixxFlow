/** Real independent sessions against an explicitly selected disposable local database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const port=Number(process.env.FIXXFLOW_RETRY_TEST_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Explicit disposable localhost port required');
const {default:postgres}=await import(process.env.FIXXFLOW_RETRY_PG_CLIENT ? pathToFileURL(process.env.FIXXFLOW_RETRY_PG_CLIENT).href : 'postgres');
const options={host:'127.0.0.1',port,user:'postgres',max:1,connect_timeout:5,onnotice:()=>{}};
const database=`fixxflow_retry_test_${process.pid}`,control=postgres({...options,database:'postgres'}),clients=[];
const connect=()=>{const sql=postgres({...options,database});clients.push(sql);return sql;};
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',employee='10000000-0000-0000-0000-000000000404';
const identity=(sql,id=employee)=>sql.unsafe(`set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify({sub:id,role:'authenticated',aal:'aal1'})}',true);`);
const payload={requester_id:employee,title:'Pilot retry',description:'Lost response',priority:'normal',routing_mode:'automatic'};
const submit=async(sql,kind,input,token)=>(await sql.unsafe('select public.submit_support_request($1,$2,$3,$4) id',[org,token,kind,sql.json(input)]))[0].id;
let created=false;
try{
 await control.unsafe(`create database ${database} template template0 encoding 'UTF8'`);created=true;
 const db=connect();
 const bootstrap=(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8')).replace(/create role ([^;]+);/g,(_,role)=>`do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
 await db.unsafe(bootstrap);
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.unsafe(await readFile(`supabase/migrations/${name}`,'utf8'));
 await db.unsafe(await readFile('tests/fixtures/domain-events.sql','utf8'));
 const first=connect(),second=connect();
 for(const [kind,input,table] of [['ticket',payload,'tickets'],['equipment',{asset:'60000000-0000-0000-0000-000000000401',title:'Equipment retry',description:'Lost response'},'ticket_assets'],['chat',{topic:'Chat retry',message:'Lost response'},'chat_messages']]){
  const token=randomUUID();let unlock,ready;
  const locked=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>unlock=resolve);
  const holding=first.begin(async tx=>{await identity(tx);const id=await submit(tx,kind,input,token);ready();await gate;return id;});
  await locked;let settled=false;
  const competing=second.begin(async tx=>{await identity(tx);return submit(tx,kind,input,token);}).finally(()=>settled=true);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'Retry must wait for the uncommitted receipt');unlock();
  const results=await Promise.all([holding,competing]);assert.equal(results[0],results[1]);
  const related=table==='tickets'?'id':table==='ticket_assets'?'ticket_id':'conversation_id';
  assert.equal((await db.unsafe(`select count(*)::int n from public.${table} where ${related}=$1`,[results[0]]))[0].n,1);
  console.log(`PASS: simultaneous ${kind} retries create one record and return one reference`);
 }
 const ticket=await db.begin(async tx=>{await identity(tx);return submit(tx,'ticket',payload,randomUUID());});
 const updates=await Promise.all([first,second].map(sql=>sql.begin(async tx=>{await identity(tx,admin);return tx.unsafe("update public.tickets set priority='high' where id=$1 and revision=1 returning revision",[ticket]);})));
 assert.equal(updates.filter(rows=>rows.length===1).length,1);assert.equal(updates.filter(rows=>rows.length===0).length,1);
 console.log('PASS: simultaneous ticket editors cannot overwrite the same revision');
 const token=randomUUID(),args=[org,token,'race-invite@example.invalid','Race Invite',admin];
 const preparations=await Promise.allSettled([first,second].map(sql=>sql.begin(async tx=>{await tx.unsafe('set local role service_role');return tx.unsafe("select public.prepare_member_invitation($1,$2,$3,$4,'end_user',$5) intent",args);} )));
 assert.equal(preparations.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(preparations.find(result=>result.status==='rejected').reason.code,'PT429');
 console.log('PASS: simultaneous invitation attempts acquire only one send lease');
 if(process.env.FIXXFLOW_RETRY_ADVISOR_CLI){
  await new Promise((resolve,reject)=>{const child=spawn(process.env.FIXXFLOW_RETRY_ADVISOR_CLI,['db','advisors','--db-url',`postgresql://postgres@127.0.0.1:${port}/${database}?sslmode=disable`,'--type','security','--level','warn','--fail-on','warn'],{stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`Advisors exited ${code}`)));});
 }
 console.log('PASS: full migration replay on native PostgreSQL '+(await db.unsafe('show server_version'))[0].server_version);
}finally{
 await Promise.all(clients.map(sql=>sql.end({timeout:5})));
 if(created)await control.unsafe(`drop database ${database}`);
 await control.end({timeout:5});
}
