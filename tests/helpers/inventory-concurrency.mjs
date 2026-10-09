/** Real multi-session test. Only an explicitly selected disposable localhost
 * PostgreSQL server is accepted; creates and removes its own test database.
 * Requires the zero-dependency `postgres` npm client in the test environment.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const port=Number(process.env.FIXXFLOW_INVENTORY_TEST_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Explicit disposable localhost port required');
const {default:postgres}=await import(process.env.FIXXFLOW_INVENTORY_PG_CLIENT ? pathToFileURL(process.env.FIXXFLOW_INVENTORY_PG_CLIENT).href : 'postgres');
const options={host:'127.0.0.1',port,user:'postgres',max:1,connect_timeout:5,onnotice:()=>{}};
const database=`fixxflow_inventory_test_${process.pid}`,control=postgres({...options,database:'postgres'});
const clients=[];
const connect=()=>{const sql=postgres({...options,database});clients.push(sql);return sql;};
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',employee='10000000-0000-0000-0000-000000000404',department='30000000-0000-0000-0000-000000000401',location='70000000-0000-0000-0000-000000000401';
const identity=(sql,id=admin)=>sql.unsafe(`set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify({sub:id,role:'authenticated',aal:'aal1'})}',true);`);
const command=async(sql,name,payload,token=randomUUID())=>(await sql.unsafe('select public.inventory_command($1,$2,$3,$4) id',[org,name,token,sql.json(payload)]))[0].id;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let created=false;
try{
 await control.unsafe(`create database ${database} template template0 encoding 'UTF8'`);created=true;
 const db=connect();
 const bootstrap=(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8')).replace(/create role ([^;]+);/g,(_,role)=>`do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
 await db.unsafe(bootstrap);
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.unsafe(await readFile(`supabase/migrations/${name}`,'utf8'));
 await db.unsafe(await readFile('tests/fixtures/domain-events.sql','utf8'));
 await db.unsafe('insert into public.locations(id,organization_id,name) values($1,$2,$3)',[location,org,'Central store']);
 await db.begin(async tx=>{await identity(tx);await command(tx,'permissions',{id:admin,manager:true,departments:[department]});await command(tx,'permissions',{id:employee,manager:false,departments:[department]});});
 const item=await db.begin(async tx=>{await identity(tx);const id=await command(tx,'create',{name:'Toner',kind:'consumable',department,location});await command(tx,'receive',{id,quantity:3});return id;});
 const request=()=>db.begin(async tx=>{await identity(tx,employee);return command(tx,'request',{id:item,quantity:2,destination:'Engineering office'});});
 const a=await request(),b=await request();
 const first=connect(),second=connect();
 let unlock,ready;const locked=new Promise(r=>ready=r),gate=new Promise(r=>unlock=r);
 const approving=first.begin(async tx=>{await identity(tx);await command(tx,'approve',{id:a});ready();await gate;});
 await locked;
 let settled=false;
 const competing=second.begin(async tx=>{await identity(tx);await command(tx,'approve',{id:b});}).finally(()=>{settled=true;});
 // Attach rejection handling immediately; this error is the expected loser.
 const rejected=assert.rejects(competing,/Insufficient available stock/);
 await delay(100);assert.equal(settled,false,'Competing approval must wait for stock lock');unlock();await approving;await rejected;
 assert.deepEqual((await db.unsafe('select stock,reserved from public.inventory_items where id=$1',[item]))[0],{stock:3,reserved:2});
 console.log('PASS: competing approvals serialize and cannot overreserve');
 const issue={id:a,destination:'Engineering office'};
 await Promise.all([first,second].map(sql=>sql.begin(async tx=>{await identity(tx);await command(tx,'issue',issue);} )));
 assert.deepEqual((await db.unsafe('select stock,reserved from public.inventory_items where id=$1',[item]))[0],{stock:1,reserved:0});
 assert.equal((await db.unsafe("select count(*)::int n from public.inventory_movements where request_id=$1 and kind='issued'",[a]))[0].n,1);
 console.log('PASS: simultaneous issuance records one handover and one debit');
 const token=randomUUID();
 const submissions=await Promise.all([first,second].map(sql=>sql.begin(async tx=>{await identity(tx,employee);return command(tx,'request',{id:item,quantity:1,destination:'Engineering office'},token);} )));
 assert.equal(submissions[0],submissions[1]);console.log('PASS: simultaneous submission retries create one request/ticket');
 const closing=submissions[0];await db.begin(async tx=>{await identity(tx);await command(tx,'approve',{id:closing});});
 const ticket=(await db.unsafe('select ticket_id from public.inventory_requests where id=$1',[closing]))[0].ticket_id;
 await Promise.all([first.begin(async tx=>{await identity(tx);await command(tx,'cancel',{id:closing});}),second.begin(async tx=>{await identity(tx);await tx.unsafe("update public.tickets set status='closed' where id=$1",[ticket]);})]);
 assert.equal((await db.unsafe('select reserved from public.inventory_items where id=$1',[item]))[0].reserved,0);
 assert.equal((await db.unsafe("select count(*)::int n from public.inventory_movements where request_id=$1 and kind='released'",[closing]))[0].n,1);
 console.log('PASS: concurrent cancellation and closing release the reservation once');
 const assetA=randomUUID(),assetB=randomUUID();
 await db.unsafe("insert into public.assets(id,organization_id,tag,name,kind) values($1,$2,'RACE-A','Race laptop A','computer'),($3,$2,'RACE-B','Race laptop B','computer')",[assetA,org,assetB]);
 const equipmentItem=await db.begin(async tx=>{await identity(tx);const id=await command(tx,'create',{name:'Race laptops',kind:'equipment',department,location});await command(tx,'receive',{id,quantity:2,assets:[assetA,assetB]});return id;});
 const equipmentRequest=()=>db.begin(async tx=>{await identity(tx,employee);return command(tx,'request',{id:equipmentItem,quantity:1,destination:'Engineering office'});});
 const equipmentA=await equipmentRequest(),equipmentB=await equipmentRequest();
 let releaseEquipment,equipmentReady;const equipmentGate=new Promise(r=>releaseEquipment=r),equipmentLocked=new Promise(r=>equipmentReady=r);
 const reserveEquipment=first.begin(async tx=>{await identity(tx);await command(tx,'approve',{id:equipmentA,assets:[assetA]});equipmentReady();await equipmentGate;});
 await equipmentLocked;
 const duplicateEquipment=assert.rejects(second.begin(async tx=>{await identity(tx);await command(tx,'approve',{id:equipmentB,assets:[assetA]});}),/already reserved/);
 await delay(100);releaseEquipment();await reserveEquipment;await duplicateEquipment;
 assert.deepEqual((await db.unsafe('select stock,reserved from public.inventory_items where id=$1',[equipmentItem]))[0],{stock:2,reserved:1});
 console.log('PASS: competing equipment approvals cannot promise the same asset, even with other stock available');
 if(process.env.FIXXFLOW_INVENTORY_ADVISORS==='1') {
  await new Promise((resolve,reject)=>{const child=spawn('npx',['--yes','supabase','db','advisors','--db-url',`postgresql://postgres@127.0.0.1:${port}/${database}?sslmode=disable`,'--level','warn'],{stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`Advisors exited ${code}`)));});
 }
 console.log('PASS: complete migration replay on native PostgreSQL '+(await db.unsafe('show server_version'))[0].server_version);
}finally{
 await Promise.all(clients.map(sql=>sql.end({timeout:5})));
 if(created)await control.unsafe(`drop database ${database}`);
 await control.end({timeout:5});
}
