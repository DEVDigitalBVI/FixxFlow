import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { definition, condition, group, action, uuid, registry, planAutomation, event } from '../../../tests/fixtures/automation.mjs';
import { ids, seed, owner, identity, ticket, createRule } from '../../../tests/helpers/automation-worker.mjs';
const { evaluateDryRun } = load('src/features/automation/dry-run.ts');
const { ticketDryRunEvent } = load('src/features/automation/domains/tickets/dry-run-context.ts');
const reads = load('src/features/automation/dry-run-repository.ts', { 'server-only': {} });
const request = (id, value = definition({ conditions: group() }), source = { kind: 'current_ticket' }) => ({ ticketId: id, definition: { kind: 'draft', value }, source });
function client(db, calls) {
  return { from() { throw Error('No table access'); }, rpc(name, args) {
    calls.push(name); assert.equal(name, 'read_automation_dry_run');
    return (async () => {
      await db.exec('savepoint dry_read');
      try {
        const { rows } = await db.query('select public.read_automation_dry_run($1,$2,$3,$4,$5,$6) value', [args.target_organization_id, args.ticket_id, args.event_id, args.rule_id, args.rule_version, args.draft]);
        await db.exec('release savepoint dry_read'); return { data: rows[0].value, error: null };
      } catch (error) {
        await db.exec('rollback to savepoint dry_read; release savepoint dry_read');
        return { data: null, error: { code: error.code, message: 'SECRET database internals' } };
      }
    })();
  } };
}
function service(db, viewer = {}, calls = []) {
  return load('src/features/automation/dry-run-service.ts', { 'server-only': {}, './dry-run-repository': reads,
    '@/lib/auth/viewer': { requireViewer: async () => ({ id: ids.admin, organizationId: ids.org, role: 'administrator', status: 'active', ...viewer }) },
    '@/lib/supabase/server': { createClient: async () => client(db, calls) },
  });
}
const tables = ['public.tickets','public.ticket_messages','public.ticket_activity','public.notifications','private.notification_email_outbox','private.domain_events','private.domain_event_deliveries','public.automation_executions','public.automation_execution_steps','public.audit_events','public.automation_rules','public.automation_rule_versions','private.automation_processing_state','private.automation_chains','private.automation_chain_claims','private.automation_command_contexts'];
async function snapshot(db) {
  await owner(db); const value = {};
  for (const table of tables) value[table] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from ${table} t`)).rows[0].data;
  return value;
}

test('Stage 6 read-only database service, authorization, references and zero side effects', async t => {
  const db = await migratedPostgres();
  try {
    const scenario = async (name, run) => t.test(name, async () => {
      await db.exec('begin'); await seed(db); const target = await ticket(db); const other = await ticket(db, ids.otherOrg); await identity(db);
      try { await run(target, other); } finally { await db.exec('rollback'); }
    });
    async function checked(input) {
      const before = await snapshot(db); await identity(db);
      const savedFetch = globalThis.fetch; let result;
      globalThis.fetch = () => { throw Error('Dry run invoked an external network dependency'); };
      try { result = await service(db).testAutomation(input); } finally { globalThis.fetch = savedFetch; }
      assert.deepEqual(await snapshot(db), before, 'Every tracked row and field must be unchanged');
      assert.equal((result.ok ? result.value : result).sideEffectsPerformed, false);
      assert.equal((result.ok ? result.value : result).notice, 'No changes were made.');
      return result;
    }
    await scenario('valid unsaved AND draft matches and proposes ordered actions without persistence', async target => {
      const value = definition({ conditions: group(condition('priority','equals',target.priority), condition('status','equals',target.status,'c2')), actions: [action('set_priority',{priority:'critical'},1), action('assign_technician',{technicianId:ids.worker},0)] });
      const result = await checked(request(target.id,value));
      assert.equal(result.ok,true); assert.equal(result.value.wouldProceed,true); assert.equal(result.value.conditions.length,2);
      assert.deepEqual(result.value.actions.map(a=>a.position),[0,1]); assert.equal(result.value.context.ruleId,null);
      assert.match(result.value.warnings.join(' '),/Hypothetical/);
    });
    await scenario('nonmatch exposes safe actual value and proposes no actions', async target => {
      const result = await checked(request(target.id,definition()));
      assert.equal(result.value.wouldProceed,false); assert.equal(result.value.conditions[0].actual,target.priority); assert.equal(result.value.actions.length,0);
    });
    await scenario('current ticket cannot prove transition compatibility', async target => {
      const result = await checked(request(target.id,definition({trigger:{type:'ticket.status_changed',configuration:{}},conditions:group()})));
      assert.equal(result.value.trigger.compatible,false); assert.match(result.value.trigger.explanation,/retained event/);
    });
    await scenario('explicit simulation uses current before and labeled status/priority after without edits', async target => {
      const result = await checked(request(target.id,definition({trigger:{type:'ticket.resolved',configuration:{}},conditions:group(condition('status','equals','resolved'))}),{kind:'simulated_transition',after:{status:'resolved',priority:'critical'}}));
      assert.equal(result.value.wouldProceed,true); assert.deepEqual(result.value.context.simulatedFields,['status','priority']); assert.match(result.value.warnings.join(' '),/simulated/);
      const same = await checked(request(target.id,definition({trigger:{type:'ticket.priority_changed',configuration:{}},conditions:group()}),{kind:'simulated_transition',after:{priority:target.priority}}));
      assert.equal(same.value.trigger.compatible,false);
    });
    await scenario('retained events pin real history and distinguish a newer current revision', async target => {
      await identity(db); await db.query("update public.tickets set priority='critical' where id=$1",[target.id]); await owner(db);
      const eventId=(await db.query("select id from private.domain_events where entity_id=$1 and event_type='ticket.priority_changed'",[target.id])).rows[0].id;
      const input=request(target.id,definition({trigger:{type:'ticket.priority_changed',configuration:{}},conditions:group()}),{kind:'retained_event',eventId});
      assert.equal((await checked(input)).value.wouldProceed,true);
      await identity(db); await db.query("update public.tickets set priority='low' where id=$1",[target.id]);
      const result=await checked(input); assert.equal(result.value.trigger.compatible,true); assert.equal(result.value.context.differsFromCurrent,true); assert.equal(result.value.wouldProceed,false); assert.equal(result.value.actions[0].validation,'blocked');
    });
    await scenario('exact immutable stored version is evaluated including disabled definitions',async target=>{
      const rule=await createRule(db,{enabled:false});
      const result=await checked({ticketId:target.id,definition:{kind:'version',ruleId:rule.id,version:1},source:{kind:'current_ticket'}});
      assert.equal(result.value.context.ruleVersion,1); assert.equal(result.value.wouldProceed,true); assert.match(result.value.warnings.join(' '),/disabled/);
    });
    for (const [type,configuration] of [['assign_technician',{technicianId:uuid(90)}],['assign_technician',{technicianId:ids.otherAdmin}],['assign_team',{teamId:uuid(91)}],['set_category',{categoryId:uuid(92)}]]) await scenario(`${type} unavailable/cross-tenant reference reports invalid`,async target=>{
      const result=await checked(request(target.id,definition({conditions:group(),actions:[action(type,configuration),action('set_priority',{priority:'critical'},1)]})));
      assert.equal(result.value.structuralValidation.valid,true); assert.equal(result.value.actions[0].validation,'invalid'); assert.equal(result.value.actions[1].validation,'blocked'); assert.equal(result.value.wouldProceed,false);
    });
    await scenario('inactive technician and notification recipients cannot pass reference validation',async target=>{
      await owner(db); await db.query("update public.organization_memberships set status='inactive',deactivated_at=clock_timestamp() where user_id=$1",[ids.worker]);
      const result=await checked(request(target.id,definition({conditions:group(),actions:[action('assign_technician',{technicianId:ids.worker}),action('send_notification',{recipient:'assigned_technician',template:'ticket_update'},1)]})));
      assert.deepEqual(result.value.actions.map(a=>a.validation),['invalid','invalid']);
      const missing=await checked(request(target.id,definition({conditions:group(),actions:[action('send_notification',{recipient:'assigned_technician',template:'ticket_update'})]})));
      assert.equal(missing.value.actions[0].validation,'invalid');
    });
    await scenario('notification recipient follows preceding proposed assignment; no enqueue or provider dependency',async target=>{
      const result=await checked(request(target.id,definition({conditions:group(),actions:[action('assign_technician',{technicianId:ids.worker}),action('send_notification',{recipient:'assigned_technician',template:'ticket_update'},1),action('send_notification',{recipient:'requester',template:'ticket_update'},2)]})));
      assert.equal(result.value.wouldProceed,true);
    });
    await scenario('invalid condition category/subcategory relationship fails current reference validation',async target=>{
      await owner(db);
      await db.query("insert into public.ticket_categories(id,organization_id,name) values($1,$2,'Dry run category')",[uuid(80),ids.org]);
      await db.query("insert into public.ticket_subcategories(id,organization_id,category_id,name) values($1,$2,$3,'Child')",[uuid(81),ids.org,uuid(80)]);
      const value=definition({conditions:group(condition('category_id','equals','50000000-0000-0000-0000-000000000401'),condition('subcategory_id','equals',uuid(81),'child'))});
      const result=await checked(request(target.id,value)); assert.equal(result.value.currentReferencesValid,false);
    });
    await scenario('cross-tenant ticket, event and rule/version sources are rejected without disclosure',async(target,other)=>{
      await owner(db); const eventId=(await db.query('select id from private.domain_events where entity_id=$1',[other.id])).rows[0].id;
      const rule=await createRule(db,{tenant:ids.otherOrg});
      for(const input of [request(other.id),request(target.id,definition(),{kind:'retained_event',eventId}),{ticketId:target.id,definition:{kind:'version',ruleId:rule.id,version:rule.version},source:{kind:'current_ticket'}}]) assert.equal((await checked(input)).error.code,'not_found');
    });
    for(const [actor,role] of [[ids.worker,'technician'],[ids.employee,'end_user']]) await scenario(`${role} denied at service and direct RPC`,async target=>{
      await identity(db,'authenticated',actor); const calls=[];
      assert.equal((await service(db,{role},calls).testAutomation(request(target.id))).error.code,'forbidden'); assert.deepEqual(calls,[]);
      await assert.rejects(reads.dryRunRepository(client(db,[]),ids.org).read(request(target.id)),e=>e.code==='42501');
    });
    await scenario('MFA enforced independently at database read boundary',async target=>{
      await owner(db); await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[ids.admin]);
      await identity(db); assert.equal((await service(db).testAutomation(request(target.id))).error.code,'forbidden');
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.admin,role:'authenticated',aal:'aal2'})]);
      assert.equal((await service(db).testAutomation(request(target.id))).ok,true);
    });
    await scenario('malformed drafts, arbitrary notification recipients and malformed simulations rejected before RPC',async target=>{
      const calls=[]; const api=service(db,{},calls);
      for(const value of [null,definition({actions:[action('send_notification',{recipient:'it_manager',template:'ticket_update'})]}),definition({actions:[action('set_category',{categoryId:uuid(1),subcategoryId:uuid(2)})]})]) assert.equal((await api.testAutomation(request(target.id,value))).error.code,'invalid_definition');
      for(const source of [{kind:'simulated_transition',after:{status:'invalid'}},{kind:'simulated_transition',after:{description:'secret'}},{kind:'simulated_transition',after:{}}]) assert.equal((await api.testAutomation(request(target.id,definition(),source))).error.code,'invalid_input');
      assert.equal((await api.testAutomation({...request(target.id),organizationId:ids.otherOrg})).error.code,'invalid_input'); assert.deepEqual(calls,[]);
    });
    await scenario('direct RPC denies arbitrary organization selection, service role and anonymous access',async target=>{
      await identity(db);
      await assert.rejects(reads.dryRunRepository(client(db,[]),ids.otherOrg).read(request(target.id)),error=>error.code==='42501');
      for(const role of ['service_role','anon']){
        await identity(db,role,ids.admin);
        await assert.rejects(reads.dryRunRepository(client(db,[]),ids.org).read(request(target.id)),error=>error.code==='42501');
      }
    });
    await scenario('missing subcategory and foreign condition references fail closed',async target=>{
      for(const c of [condition('subcategory_id','equals',uuid(97)),condition('assigned_technician_id','equals',ids.otherAdmin)]){
        const result=await checked(request(target.id,definition({conditions:group(c)})));assert.equal(result.value.currentReferencesValid,false);assert.equal(result.value.wouldProceed,false);
      }
    });
    await scenario('note bodies are not copied into the result and stored historical definitions remain pinned',async target=>{
      const note=definition({conditions:group(),actions:[action('add_internal_note',{body:'PRIVATE NOTE BODY'})]});
      const noteResult=await checked(request(target.id,note));assert.equal(noteResult.value.wouldProceed,true);assert.doesNotMatch(JSON.stringify(noteResult),/PRIVATE NOTE BODY/);
      const rule=await createRule(db,{enabled:false,actions:note.actions});
      await identity(db);await db.query('select public.update_automation_rule($1,$2,$3,$4)',[ids.org,rule.id,rule.version,definition({conditions:group(),actions:[action('set_status',{status:'open'})]})]);
      const result=await checked({ticketId:target.id,definition:{kind:'version',ruleId:rule.id,version:1},source:{kind:'current_ticket'}});
      assert.equal(result.value.actions[0].type,'add_internal_note');assert.equal(result.value.context.ruleVersion,1);
    });
    await scenario('read adapter reference parity with the trusted mutation validator',async()=>{
      await owner(db);
      for(const resource of ['active_ticket_workers','organization_memberships','teams','ticket_categories','ticket_subcategories','departments','locations']) for(const target of [ids.worker,ids.employee,ids.otherAdmin,uuid(44),'40000000-0000-0000-0000-000000000401','50000000-0000-0000-0000-000000000401','30000000-0000-0000-0000-000000000401']) for(const active of [true,false]) {
        const row=(await db.query('select private.automation_reference_read($1,$2,$3,$4) actual, private.automation_ticket_reference($1,$2,$3,$4) expected',[ids.org,resource,target,active])).rows[0];assert.equal(row.actual,row.expected);
      }
    });
  } finally { await db.close(); }
});

for(const [field,operator,value] of [['priority','equals','critical'],['priority','not_equals','low'],['priority','greater_than','low'],['priority','less_than','critical'],['priority','in',['critical']],['priority','not_in',['low']],['title','contains','Network'],['title','not_contains','Software'],['team_id','is_empty'],['team_id','is_not_empty']]) test(`pure planner/dry-run parity: ${operator}`,()=>{
  const e=event();const d=definition({conditions:group(condition(field,operator,value))});
  const context={organizationId:e.organizationId,ticketId:e.entityId,ticketNumber:1,revision:e.entityVersion,snapshot:e.after,event:null,definition:d,ruleId:null,ruleVersion:null,storedEnabled:null,storedArchived:false,conditionsReferencesValid:true,actionReferences:d.actions.map(a=>({actionId:a.id,valid:true}))};
  const source={kind:'current_ticket'};const plannedEvent=ticketDryRunEvent(context,source);
  const rule={id:context.ticketId,organizationId:e.organizationId,version:1,enabled:true,createdBy:context.ticketId,createdAt:'1970-01-01T00:00:00Z',updatedAt:'1970-01-01T00:00:00Z',definition:d};
  const plan=planAutomation(rule,plannedEvent,registry,e.organizationId), dry=evaluateDryRun(context,plannedEvent,source,registry);
  assert.equal(dry.plannerStatus,plan.status);assert.deepEqual(dry.conditions.map(c=>c.status),plan.conditions.map(c=>c.status));assert.deepEqual(dry.actions.map(a=>a.id),plan.actions.map(a=>a.action.id));
  if(field==='title') {assert.equal(dry.conditions[0].actualRedacted,true);assert.equal(dry.conditions[0].actual,undefined);}
});

test('dry-run runtime dependency graph excludes execution and external effect modules',async()=>{
  const visited=new Set();
  const boundaries=new Set(['@/lib/auth/viewer','@/lib/supabase/server','server-only']);
  async function visit(file){
    if(visited.has(file))return;visited.add(file);
    const source=await readFile(file,'utf8');
    assert.doesNotMatch(file,/worker|execution|notifications|events\/delivery|supabase\/admin/);
    assert.doesNotMatch(source,/fetch\(|\.insert\(|\.update\(|\.from\(|enqueue_notification|publish_domain_event|begin_automation_execution|execute_automation_ticket_step/);
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    for(const [,name] of compiled.matchAll(/require\("([^"']+)"\)/g)){
      if(boundaries.has(name))continue;
      assert.ok(name.startsWith('.')||name.startsWith('@/'),`Unexpected external dependency: ${name}`);
      const base=name.startsWith('@/')?path.join('src',name.slice(2)):path.join(path.dirname(file),name);
      await visit(`${base}.ts`);
    }
  }
  await visit('src/features/automation/dry-run-service.ts');
  assert.ok(visited.has('src/features/automation/planner.ts'));assert.ok(visited.has('src/features/automation/conditions.ts'));
});

test('dry-run read RPC works in a READ ONLY transaction with processing OFF',async()=>{
  const db=await migratedPostgres();
  try {
    await db.exec('begin');await seed(db);const target=await ticket(db);await db.exec('commit');
    await db.exec('begin read only'); await identity(db);
    const result=await service(db).testAutomation(request(target.id));assert.equal(result.value.wouldProceed,true);
    await owner(db);assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active,false);
    const signature=(await db.query("select provolatile,proargnames from pg_proc where oid='public.read_automation_dry_run(uuid,uuid,uuid,uuid,bigint,jsonb)'::regprocedure")).rows[0];
    assert.equal(signature.provolatile,'s');assert.deepEqual(signature.proargnames,['target_organization_id','ticket_id','event_id','rule_id','rule_version','draft']);
    await db.exec('rollback');
  }finally{await db.close();}
});

test('implicit platform owner, inactive admin and MFA redirects preserve service boundaries',async()=>{
  for(const viewer of [{role:'platform_owner'},{status:'inactive'}]) {
    const calls=[];assert.equal((await service(null,viewer,calls).testAutomation(request(uuid(1)))).error.code,'forbidden');assert.deepEqual(calls,[]);
  }
  const redirect=Error('NEXT_REDIRECT');
  const api=load('src/features/automation/dry-run-service.ts',{'server-only':{},'@/lib/auth/viewer':{requireViewer:async()=>{throw redirect;}},'@/lib/supabase/server':{createClient:()=>{throw Error('Unexpected client');}}});
  await assert.rejects(api.testAutomation(request(uuid(1))),error=>error===redirect);
});
