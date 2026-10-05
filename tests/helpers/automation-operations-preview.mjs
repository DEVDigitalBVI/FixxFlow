/** Isolated static rendering of real Operations components with synthetic data.
 * No Supabase client, credentials, worker, network data source or activation.
 * Run from repository root; localhost:4181. */
import http from 'node:http';import fs from 'node:fs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {load} from './load-module.mjs';
import {overview,rows,recentHeartbeat} from '../fixtures/automation-operations.mjs';
const filterModel=load('src/features/automation/operations-service.ts',{'server-only':{},'./ui-service':{},'@/lib/supabase/server':{}});
const mocks={'server-only':{},'next/link':{default:p=>React.createElement('a',p)}};
const {OperationsOverviewView,OperationsHistoryTable}=load('src/features/automation/operations-view.tsx',mocks);
const history=load('src/app/app/administration/automations/operations/history/page.tsx',{...mocks,'@/features/automation/operations-service':{automationOperationsHistory:async input=>({rows,hasNext:true,since:'2026-09-30T12:00:00Z',until:overview.now,error:'',filters:filterModel.operationsHistoryFilters(input)})}}).default;
const markup={};
for(const state of ['off','unknown','healthy','degraded','capacity']){
 const data={...overview,...(state==='capacity'?{queue:{...overview.queue,sampled:12,capacityDeferred:12,notificationDeferred:4,oldestCapacityDeferredAt:overview.now}}:{}),processingActive:state!=='off',worker:state==='healthy'?recentHeartbeat:state==='degraded'?{...recentHeartbeat,latestCompletedResult:'failed'}:overview.worker};
 markup['/'+state]=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement('h1',null,'Automation Operations'),React.createElement(OperationsOverviewView,{data}),React.createElement('section',{className:'settings-card stack'},React.createElement('h2',null,'Recent failures'),React.createElement(OperationsHistoryTable,{rows}))));
}
markup['/history']=renderToStaticMarkup(await history({searchParams:Promise.resolve({q:'Network'})}));
http.createServer((req,res)=>{
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync('src/app/globals.css'));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main class="page automation-page"><p>Synthetic Operations preview · actual processing OFF</p>${markup[req.url]??markup['/off']}</main></body></html>`);
}).listen(4181,'127.0.0.1',()=>console.log('Isolated Operations preview: http://127.0.0.1:4181'));
