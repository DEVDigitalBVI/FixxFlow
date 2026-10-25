import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migratedPostgres} from '../../../tests/helpers/postgres.mjs';

test('knowledge audience policies cover articles, search, related links, feedback, attachments and Storage',async()=>{
 const db=await migratedPostgres();
 const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),tech=randomUUID(),employee=randomUUID(),foreign=randomUUID();
 const ids={employee:randomUUID(),internal:randomUUID(),draft:randomUUID(),archived:randomUUID()};
 const identity=async(id,aal='aal1')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aal})]);await db.exec('set role authenticated');};
 try{
  await db.query("insert into public.organizations(id,name,slug) values($1,'Audience','knowledge-audience'),($2,'Foreign','knowledge-foreign')",[org,otherOrg]);
  for(const [id,role,company] of [[admin,'administrator',org],[tech,'technician',org],[employee,'end_user',org],[foreign,'administrator',otherOrg]]){
   await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.test`]);
   await db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[company,id,role]);
  }
  for(const [key,audience,status] of [['employee','employees','published'],['internal','it_only','published'],['draft','employees','draft'],['archived','employees','archived']]){
   await db.query("insert into public.knowledge_articles(id,organization_id,category,title,content,audience,status) values($1,$2,'Software',$3,$4,$5,$6)",[ids[key],org,`Audience probe ${key}`,JSON.stringify([{type:'paragraph',text:`Audience probe ${key} content`}]),audience,status]);
   const path=`${org}/${ids[key]}/guide.pdf`;
   await db.query("insert into public.knowledge_attachments(organization_id,article_id,storage_path,file_name,content_type,size_bytes) values($1,$2,$3,'guide.pdf','application/pdf',100)",[org,ids[key],path]);
   await db.query("insert into storage.objects(bucket_id,name) values('knowledge-assets',$1)",[path]);
  }
  await db.query('update public.knowledge_articles set related_article_ids=$1 where id=$2',[[ids.internal],ids.employee]);
  await identity(employee);
  assert.deepEqual((await db.query('select id from public.knowledge_articles where organization_id=$1',[org])).rows.map(r=>r.id),[ids.employee]);
  assert.deepEqual((await db.query("select id from public.search_knowledge_articles($1,'Audience probe')",[org])).rows.map(r=>r.id),[ids.employee]);
  assert.equal((await db.query('select id from public.knowledge_articles where id=any($1)',[[ids.internal]])).rows.length,0,'related internal guide cannot be fetched');
  assert.equal((await db.query('select article_id from public.knowledge_attachments where organization_id=$1',[org])).rows.length,1);
  assert.equal((await db.query("select name from storage.objects where bucket_id='knowledge-assets'")).rows.length,1);
  await db.query('select public.rate_article($1,$2,true)',[org,ids.employee]);
  await assert.rejects(db.query('select public.rate_article($1,$2,true)',[org,ids.internal]),{code:'42501'});
  await assert.rejects(db.query('select public.record_article_view($1,$2)',[org,ids.internal]),{code:'42501'});
  assert.equal((await db.query("update public.knowledge_articles set audience='employees' where id=$1 returning id",[ids.internal])).rows.length,0);
  await assert.rejects(db.query("insert into public.knowledge_articles(organization_id,category,title,audience) values($1,'Software','Forbidden guide','employees')",[org]),{code:'42501'});
  for(const id of [admin,tech]){await identity(id);assert.equal((await db.query('select id from public.knowledge_articles where organization_id=$1',[org])).rows.length,4);}
  await identity(admin);
  const draft=(await db.query("insert into public.knowledge_articles(organization_id,category,title) values($1,'Software','Default draft') returning audience",[org])).rows[0];
  assert.equal(draft.audience,'it_only');
  await db.query("update public.knowledge_articles set audience='it_only' where id=$1",[ids.employee]);
  assert.ok((await db.query("select changes from public.audit_events where entity_id=$1 and changes::text like '%audience%'",[ids.employee])).rows.length>0);
  await identity(employee);assert.equal((await db.query('select * from public.knowledge_article_feedback')).rows.length,0,'previous votes do not expose a newly private article');
  await identity(foreign);assert.equal((await db.query('select id from public.knowledge_articles where organization_id=$1',[org])).rows.length,0);
  await identity(admin);await db.query("update public.knowledge_articles set audience='employees' where id=$1",[ids.employee]);
  await db.exec('reset role');await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),$1,'totp','verified',now(),now())",[employee]);
  await identity(employee);assert.equal((await db.query('select id from public.knowledge_articles')).rows.length,0);
  await identity(employee,'aal2');assert.equal((await db.query('select id from public.knowledge_articles')).rows.length,1);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");
  await db.exec(await readFile('supabase/tests/knowledge-regression.sql','utf8'));
 }finally{await db.close();}
});

test('audience migration exposes only unchanged content reviewed for employees',async()=>{
 const catalog=JSON.parse(await readFile('content/knowledge/general-it.json','utf8')).articles;
 const review=JSON.parse(await readFile('docs/knowledge-audience-review.json','utf8')).articles;
 const first=review.find(a=>a.title==='A printer is offline or your document will not print');
 const changed=review.find(a=>a.title==='A website will not load or the browser stops responding');
 const org=randomUUID();
 const db=await migratedPostgres({beforeMigration:async(db,name)=>{
  if(!name.endsWith('_knowledge_article_audiences.sql'))return;
  await db.query("insert into public.organizations(id,name,slug) values($1,'Review','review-backfill')",[org]);
  for(const entry of [first,changed]){
   const source=catalog.find(a=>a.title===entry.title);
   await db.query("insert into public.knowledge_articles(id,organization_id,title,summary,category,content,status) values($1,$2,$3,$4,$5,$6,'published')",[entry.id,org,entry.title,source.summary,source.category,JSON.stringify(entry===changed?[{type:'paragraph',text:'Content changed after review.'}]:source.content)]);
  }
 }});
 try{
  const rows=(await db.query('select id,audience from public.knowledge_articles where organization_id=$1',[org])).rows;
  assert.equal(rows.find(a=>a.id===first.id).audience,'employees');
  assert.equal(rows.find(a=>a.id===changed.id).audience,'it_only');
 }finally{await db.close();}
});

test('knowledge imports honor explicit audiences and default unreviewed imports to IT only',async()=>{
 const {buildImport}=await import('../../../scripts/knowledge-import.mjs');
 const db=await migratedPostgres();const org=randomUUID();
 try{
  await db.query("insert into public.organizations(id,name,slug) values($1,'Imports','audience-imports')",[org]);
  const article=(key,audience)=>({key,title:`Import ${key}`,summary:'Guidance',category:'Software',content:[{type:'paragraph',text:'Instructions'}],related:[],...(audience?{audience}:{})});
  await db.exec(buildImport({articles:[article('employee','employees'),article('internal','it_only'),article('unreviewed')]},org,'audience-imports'));
  const rows=(await db.query('select title,audience from public.knowledge_articles where organization_id=$1',[org])).rows;
  assert.equal(rows.find(a=>a.title==='Import employee').audience,'employees');
  assert.equal(rows.find(a=>a.title==='Import internal').audience,'it_only');
  assert.equal(rows.find(a=>a.title==='Import unreviewed').audience,'it_only');
 }finally{await db.close();}
});
