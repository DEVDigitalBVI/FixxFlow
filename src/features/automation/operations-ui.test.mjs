import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup as render} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
import {overview,rows,recentHeartbeat} from '../../../tests/fixtures/automation-operations.mjs';
const mocks={'server-only':{},'next/link':{default:p=>React.createElement('a',p)}};
const {OperationsOverviewView,OperationsHistoryTable}=load('src/features/automation/operations-view.tsx',mocks);
test('Operations OFF and empty states are intentional, accessible and read only',()=>{
 const html=render(React.createElement(OperationsOverviewView,{data:overview}));
 for(const text of ['processing is currently disabled','Enabled rules do not activate processing','Disabled','No executions','No pending work','No enabled temporal rules','Never recorded','No threshold observations'])assert.ok(html.includes(text),text);
 assert.match(html,/<h2>Worker<\/h2>/);assert.match(html,/<summary>How service health/);assert.match(html,/<dt/);assert.doesNotMatch(html,/<button|<input|Force execute|Replay event|Clear queue/);
});
test('Operations never-run, healthy, degraded and delayed signals include text',()=>{
 for(const [worker,label] of [[overview.worker,'Unknown'],[recentHeartbeat,'Healthy'],[{...recentHeartbeat,latestCompletedResult:'failed'},'Degraded'],[{...recentHeartbeat,lastStartedAt:'2026-10-01T11:00:00Z'},'Delayed']]){
  const html=render(React.createElement(OperationsOverviewView,{data:{...overview,processingActive:true,worker}}));assert.ok(html.includes(label));
 }
});
test('partial queues, SLA lag and missed windows explain incomplete observations without changing semantics',()=>{
 const html=render(React.createElement(OperationsOverviewView,{data:{...overview,queue:{...overview.queue,truncated:true},lag:{...overview.lag,missedWindow:2,maxSeconds:420,latestSeconds:420},temporalRules:[{id:'rule',name:'Resolution reminder',version:2,trigger:'ticket.sla_approaching',durationMinutes:5,lastScannedAt:null,atRisk:true}]}}));
 for(const text of ['lower bounds','420 seconds','missed window','not executed or converted','Processing off · risk is not an active alert','Completed tickets or old thresholds'])assert.ok(html.includes(text),text);
});
test('global history uses pinned names/versions, separate exhaustion and semantic responsive tables',()=>{
 const html=render(React.createElement(OperationsHistoryTable,{rows}));for(const text of ['Historical Network Routing','Version 1','Retry exhausted','Ticket #1842','2 of 3 completed'])assert.ok(html.includes(text));
 assert.match(html,/scope="row"/);assert.match(html,/scope="col"/);assert.match(html,/tabindex="0"/);assert.match(html,/responsive-table/);assert.match(html,/\/history\//);
});
test('Operations pages expose native filters, no-failures state and bounded cursor links',async()=>{
 const {operationsHistoryFilters}=load('src/features/automation/operations-service.ts',{'server-only':{},'./ui-service':{},'@/lib/supabase/server':{}});
 const services={automationOperations:async()=>overview,automationOperationsHistory:async input=>({rows:input.result==='failures'?[]:rows,hasNext:true,since:'2026-09-30T12:00:00Z',until:overview.now,filters:operationsHistoryFilters(input),error:''})};
 const allMocks={...mocks,'@/features/automation/operations-service':services};
 const page=load('src/app/app/administration/automations/operations/page.tsx',allMocks).default;assert.match(render(await page()),/No execution failures/);
 const history=load('src/app/app/administration/automations/operations/history/page.tsx',allMocks).default;
 const html=render(await history({searchParams:Promise.resolve({q:'Network'})}));for(const label of ['Automation name','Result','Trigger','Ticket number','From date','Through date','Older results'])assert.ok(html.includes(label));assert.match(html,/name="q"[^>]*value="Network"/);assert.match(html,/cursor=/);assert.match(html,/until=/);assert.match(html,/since=/);
});
test('server reads derive organization from authorization and mask database activation when deployment is OFF',async()=>{
 const calls=[];let denied=false;const prior=process.env.AUTOMATION_PROCESSING_ENABLED;delete process.env.AUTOMATION_PROCESSING_ENABLED;
 const {automationOperations,automationOperationsHistory}=load('src/features/automation/operations-service.ts',{'server-only':{},'./ui-service':{requireAutomationAdmin:async()=>{if(denied)throw Error('DENIED');return{organizationId:'trusted-org'};}},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:name==='read_automation_operations'?{...overview,processingActive:true}:{rows:[],hasNext:false},error:null};}})}});
 try{assert.equal((await automationOperations()).processingActive,false);await automationOperationsHistory({org:'foreign',q:'Network'});assert.ok(calls.every(c=>c.args.org==='trusted-org'));denied=true;await assert.rejects(automationOperations(),/DENIED/);await assert.rejects(automationOperationsHistory({}),/DENIED/);assert.equal(calls.length,2);}finally{if(prior===undefined)delete process.env.AUTOMATION_PROCESSING_ENABLED;else process.env.AUTOMATION_PROCESSING_ENABLED=prior;}
});

test('Stage 12 capacity delay has distinct text, tenant counts and no noisy live region',()=>{
 const data={...overview,processingActive:true,queue:{...overview.queue,capacityDeferred:7,notificationDeferred:2,oldestCapacityDeferredAt:overview.now}};
 const html=render(React.createElement(OperationsOverviewView,{data}));
 for(const label of ['Delayed by capacity','Notification capacity delay','Oldest capacity delay','No work has been lost','Delayed','Retry exhausted','Action failed','Safety limit reached','does not make the service degraded'])assert.ok(html.includes(label),label);
 assert.doesNotMatch(html,/aria-live|role="alert"/);
 const {queueHealth}=load('src/features/automation/operations-model.ts');assert.equal(queueHealth(true,data.queue,data.now),'delayed');assert.equal(queueHealth(false,data.queue,data.now),'disabled');
});
