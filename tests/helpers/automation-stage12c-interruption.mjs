/** Real worker process interruption and wall-clock lease recovery. Docker only. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {service,sql,json,literal,ok} from './automation-stage12c-recovery-env.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';
import {load} from './load-module.mjs';
const {runAutomationWorker}=load('src/features/automation/worker.ts',{'server-only':{}});
const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',{'server-only':{}});

if(process.argv.includes('--child')) {
  const {org}=await new Promise(resolve=>process.once('message',resolve));
  const repository=automationWorkerRepository(service),execute=repository.execute;
  repository.execute=async(delivery,execution,step)=>{
    const receipt=await execute(delivery,execution,step);
    if(execution.organization_id===org) {
      process.send({type:'committed-step'});
      // Hold immediately after a genuine committed command, before the worker
      // can read/finish the execution. The parent terminates this process.
      await delay(180000);
    }
    return receipt;
  };
  for(let i=0;i<10;i++)await runAutomationWorker(repository,{enabled:true});
  throw new Error('Expected interruption boundary not reached');
} else {
  assert.equal(sql('select active from private.automation_processing_state'),'f');
  const org=randomUUID();
  const admin=ok(await service.auth.admin.createUser({email:`stage12c-interrupt-${org}@example.invalid`,email_confirm:true})).user.id;
  const identity=`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:admin,role:'authenticated',aal:'aal1'}))},true);`;
  const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic first receipt'},0),action('add_internal_note',{body:'Synthetic second receipt'},1)]});
  sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12C interruption','interrupt-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);
  const rule=JSON.parse(sql(`begin;${identity}select row_to_json(r) from public.create_automation_rule('${org}',${json(draft)})r;commit;`).split('\n').at(-1));
  sql(`begin;${identity}select public.set_automation_rule_enabled('${org}','${rule.id}',1,true);commit;`);
  let child;
  const report={engine:sql('show server_version'),scope:'Independent actual worker process; real 120-second lease; fixed isolated upgrade Docker stack',startedAt:new Date().toISOString()};
  try {
    sql('select private.set_automation_processing(true)');
    sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Interrupted worker synthetic ticket','Synthetic');commit;`);
    child=fork(fileURLToPath(import.meta.url),['--child'],{stdio:['ignore','ignore','pipe','ipc']});
    let childError='';child.stderr.on('data',chunk=>{childError+=chunk;});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Worker did not reach committed step within 30 seconds')),30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error(`Worker exited before interruption (${childError.length} diagnostic bytes)`));});
      child.once('message',message=>{clearTimeout(timer);assert.equal(message.type,'committed-step');resolve();});
      child.send({org});
    });
    const lease=JSON.parse(sql(`select to_jsonb(d) from private.domain_event_deliveries d join private.domain_events e on e.id=d.event_id where e.organization_id='${org}' and d.status='leased' limit 1`));
    const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped;
    assert.equal(sql(`select sum(attempts) from public.automation_execution_steps where organization_id='${org}'`),'1');
    report.interruptedAfterCommittedStep='PASS';console.log('PASS worker terminated after one committed step; waiting for original lease expiry');
    const waitMs=Math.max(0,new Date(lease.lease_expires_at).getTime()-Date.now()+1000);
    report.actualLeaseWaitMs=waitMs;await delay(waitMs);
    const batches=[];
    for(let i=0;i<10;i++){
      batches.push(await runAutomationWorker(automationWorkerRepository(service),{enabled:true}));
      if(sql(`select count(*) from public.automation_executions where organization_id='${org}' and status='succeeded'`)==='1')break;
    }
    assert.equal(sql(`select count(*) from public.automation_executions where organization_id='${org}' and status='succeeded'`),'1');
    assert.equal(sql(`select count(*) from public.automation_execution_steps where organization_id='${org}' and attempts=1`),'2');
    assert.equal(sql(`select count(*) from public.ticket_messages where organization_id='${org}'`),'2');
    // Finish is deliberately a boolean fence, unlike action commands which
    // return a permission error for an obsolete token.
    assert.equal(ok(await service.rpc('finish_domain_event_delivery',{delivery_id:lease.id,token:lease.lease_token,outcome:'acknowledged'})),false);
    report.recoveredWithoutRepeatedCompletedStep='PASS';report.oldTokenDenied='PASS';report.batches=batches;
    report.result='PASS';
  } catch(error) {report.result='FAIL';report.error=error.message;throw error;}
  finally {
    if(child&&!child.killed)child.kill('SIGTERM');
    sql('select private.set_automation_processing(false)');report.processing='OFF';report.finishedAt=new Date().toISOString();
    writeFileSync('/tmp/fixxflow-stage12c-interruption-results.json',JSON.stringify(report,null,2));
  }
  console.log('PASS wall-clock lease reclaim, token fencing, completed-step preservation; processing OFF');
}
