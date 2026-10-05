/** Run manually against the disposable Stage 12B stack. Never loads .env files. */
import assert from 'node:assert/strict';
import {randomUUID, randomBytes, createHmac} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {client, local, service, sql, json, literal, ok} from './automation-stage12b-local.mjs';
import {definition, action, group} from '../fixtures/automation.mjs';
import {load} from './load-module.mjs';
const report={engine:sql('show server_version'),gates:{},processing:'OFF'};
const pass=name=>{report.gates[name]='PASS';console.log(`PASS ${name}`);};
const users=[];
for(const name of ['admin-a','admin-b','technician','employee']) {
  const email=`stage12b-${name}-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');
  const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;
  const session=client(local.ANON_KEY);ok(await session.auth.signInWithPassword({email,password}));
  users.push({id:user.id,session,email,password});
}
const [a,b,tech,employee]=users, orgA=randomUUID(),orgB=randomUUID();
sql(`insert into public.organizations(id,name,slug) values('${orgA}','Stage 12B A','stage12b-${orgA}'),('${orgB}','Stage 12B B','stage12b-${orgB}');
insert into public.organization_memberships(organization_id,user_id,role) values('${orgA}','${a.id}','administrator'),('${orgB}','${b.id}','administrator'),('${orgA}','${tech.id}','technician'),('${orgA}','${employee.id}','end_user');`);
const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic Stage12B secret body must not enter telemetry'})]});
const rpc=async(user,name,args)=>ok(await user.session.rpc(name,args));
const create=async(user,org,d=draft)=>(await rpc(user,'create_automation_rule',{target_organization_id:org,definition:d}));
// Real GoTrue TOTP enrollment/verification: no forged JWT or SQL MFA fixture.
const factor=ok(await a.session.auth.mfa.enroll({factorType:'totp',friendlyName:'Stage12B disposable'}));
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...factor.totp.secret.replace(/=/g,'')].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2)));
const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
const hmac=createHmac('sha1',key).update(counter).digest(),offset=hmac.at(-1)&15;
const code=String((hmac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
ok(await a.session.auth.mfa.challengeAndVerify({factorId:factor.id,code}));
assert.equal(ok(await a.session.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel,'aal2');
const low=client(local.ANON_KEY);ok(await low.auth.signInWithPassword({email:a.email,password:a.password}));
assert.equal((await low.rpc('create_automation_rule',{target_organization_id:orgA,definition:draft})).error?.code,'42501');
pass('real_auth_mfa_aal2_and_insufficient_aal1_denial');
let rule=await create(a,orgA);assert.equal(rule.enabled,false);
rule=(await rpc(a,'update_automation_rule',{target_organization_id:orgA,rule_id:rule.id,expected_version:1,definition:{...draft,name:'Edited synthetic rule'}}));
assert.equal((await a.session.rpc('update_automation_rule',{target_organization_id:orgA,rule_id:rule.id,expected_version:1,definition:draft})).error?.code,'40001');
let copy=(await rpc(a,'duplicate_automation_rule',{target_organization_id:orgA,rule_id:rule.id,expected_version:rule.version,name:'Copy'}));
assert.equal(copy.enabled,false);
for(const enabled of [true,false]) copy=(await rpc(a,'set_automation_rule_enabled',{target_organization_id:orgA,rule_id:copy.id,expected_version:copy.version,enabled}));
copy=(await rpc(a,'archive_automation_rule',{target_organization_id:orgA,rule_id:copy.id,expected_version:copy.version}));assert.ok(copy.archived_at);
pass('create_edit_duplicate_enable_disable_archive_and_revision_conflict');
const ticket=ok(await a.session.from('tickets').insert({organization_id:orgA,requester_id:employee.id,title:'Synthetic boundary ticket',description:'No real customer data'}).select('id').single());
await create(b,orgB);
for(const denied of [tech.session,employee.session,low,b.session]) {
  for(const [name,args] of [
    ['create_automation_rule',{target_organization_id:orgA,definition:draft}],
    ['read_automation_admin',{org:orgA,kind:'references',resource:'teams'}],
    ['read_automation_dry_run',{target_organization_id:orgA,ticket_id:ticket.id,draft}],
    ['read_automation_operations',{org:orgA}],
    ['read_automation_operations_history',{org:orgA}],
  ]) assert.equal((await denied.rpc(name,args)).error?.code,'42501',name);
  assert.equal(ok(await denied.from('automation_rules').select('id').eq('organization_id',orgA)).length,0);
  assert.ok((await denied.rpc('claim_automation_events',{})).error);
}
assert.equal(ok(await a.session.from('automation_rules').select('id').eq('organization_id',orgB)).length,0);
pass('technician_employee_cross_tenant_rules_references_dry_run_history_operations_denial');
const snapshot=()=>sql(`select jsonb_object_agg(s.n,s.rows) from (
 select 'rules' n,jsonb_agg(to_jsonb(t) order by id) rows from public.automation_rules t union all
 select 'tickets',jsonb_agg(to_jsonb(t) order by id) from public.tickets t union all
 select 'events',jsonb_agg(to_jsonb(t) order by id) from private.domain_events t union all
 select 'deliveries',jsonb_agg(to_jsonb(t) order by id) from private.domain_event_deliveries t union all
 select 'executions',jsonb_agg(to_jsonb(t) order by id) from public.automation_executions t union all
 select 'steps',jsonb_agg(to_jsonb(t) order by id) from public.automation_execution_steps t union all
 select 'notifications',jsonb_agg(to_jsonb(t) order by id) from public.notifications t union all
 select 'capacity',jsonb_agg(to_jsonb(t) order by organization_id,resource,subject) from private.automation_capacity t union all
 select 'schedule',jsonb_agg(to_jsonb(t) order by organization_id) from private.automation_tenant_schedule t
)s;`);
const before=snapshot();await rpc(a,'read_automation_dry_run',{target_organization_id:orgA,ticket_id:ticket.id,draft});assert.equal(snapshot(),before);
assert.ok((await a.session.rpc('read_automation_dry_run',{target_organization_id:orgA,ticket_id:ticket.id,draft:{...draft,name:'x'.repeat(121)}})).error);
pass('dry_run_structural_validation_zero_runtime_side_effects');
assert.ok((await a.session.rpc('create_automation_rule',{target_organization_id:orgA,definition:{...draft,name:'x'.repeat(121)}})).error);
// The setup uses the same public commands with an owner-controlled test session;
// the final contention is independent HTTP requests through PostgREST.
sql(`begin;set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:a.id,role:'authenticated',aal:'aal2'}))},true);
do $$ declare r public.automation_rules;begin for i in 1..99 loop r:=public.create_automation_rule('${orgA}',${json(draft)});perform public.set_automation_rule_enabled('${orgA}',r.id,1,true);end loop;end $$;commit;`);
const c=await create(a,orgA),d=await create(a,orgA);
const race=await Promise.all([c,d].map(r=>a.session.rpc('set_automation_rule_enabled',{target_organization_id:orgA,rule_id:r.id,expected_version:1,enabled:true})));
assert.equal(race.filter(r=>r.error?.code==='FF001').length,1);assert.equal(race.filter(r=>!r.error).length,1);
assert.equal(sql(`select count(*) from public.automation_rules where organization_id='${orgA}' and enabled`),'100');
assert.equal((await create(a,orgA)).enabled,false);
pass('independent_http_enable_race_ceiling_and_disabled_creation');
// Preserve state for subsequent local worker verification. Session material stays
// only in a private temporary credential file, never evidence or committed files.
writeFileSync('/tmp/fixxflow-stage12b-test-session.json',JSON.stringify({orgA,orgB,users:users.map(u=>({id:u.id,email:u.email,password:u.password})),ruleId:rule.id}),{mode:0o600});
assert.equal(sql('select active from private.automation_processing_state'),'f');
writeFileSync('/tmp/fixxflow-stage12b-postgrest-results.json',JSON.stringify(report,null,2));
console.log('PASS processing_OFF');
// Keep this import exercised here: the real repository boundary is used next.
assert.equal(typeof load('src/features/automation/worker-repository.ts',{'server-only':{}}).automationWorkerRepository,'function');
