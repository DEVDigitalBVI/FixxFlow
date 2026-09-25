import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeQueueFilters } from './queue-filters.ts';
const require=createRequire(import.meta.url);
test('ticket search calls the permission-scoped RPC and preserves filters in pagination',async()=>{
 const calls=[];
 const rows=Array.from({length:51},(_,i)=>({id:String(i),title:'Search result',ticket_number:i,status:'open',priority:'normal',updated_at:'2026-09-25T00:00:00Z'}));
 const builder=(data)=>new Proxy({}, {get:(_,key)=>key==='then' ? (resolve)=>Promise.resolve({data,error:null}).then(resolve) : (...args)=>{calls.push([key,...args]);return builder(data);}});
 const mocks={
  '@/features/product-analytics/usage-event':{UsageEvent:()=>null},
  '@/features/tickets/bulk-actions':{BulkActions:({children})=>children},
  'next/link':{default:props=>React.createElement('a',props)},
  '@/lib/auth/viewer':{requireViewer:async()=>({id:'staff',organizationId:'org',role:'technician'})},
  '@/lib/supabase/server':{createClient:async()=>({rpc:(...args)=>{calls.push(['rpc',...args]);return builder(rows);},from:()=>builder([])})},
  '@/features/tickets/conversation-refresh':{ConversationRefresh:()=>null},
  '@/features/tickets/sla-indicator':{SlaClock:({children})=>children,SlaIndicator:()=>null},
  '@/features/tickets/presentation':{formatTicketDate:x=>x,ticketStatuses:{open:{label:'Open'}},ticketPriorities:{normal:{label:'Normal'}}},
  '@/features/tickets/bulk-select-all':{BulkSelectAll:()=>null},
  '@/features/tickets/queue-filters':{normalizeQueueFilters},
  './actions':{bulkUpdateTickets:async()=>{}},
 };
 const compiled=ts.transpileModule(fs.readFileSync('src/app/app/tickets/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',compiled)(n=>n in mocks?mocks[n]:require(n),m,m.exports);
 const html=renderToStaticMarkup(await m.exports.default({searchParams:Promise.resolve({q:'VPN error 809',status:'open',page:'2'})}));
 assert.deepEqual(calls.find(c=>c[0]==='rpc'),['rpc','search_tickets',{target_organization_id:'org',search_text:'VPN error 809'}]);
 assert.ok(calls.some(c=>c[0]==='range'&&c[1]===50&&c[2]===100));
 assert.match(html,/q=VPN\+error\+809&amp;status=open&amp;page=3/);
 assert.match(html,/aria-label="Ticket pages"/);
 assert.match(html,/aria-describedby="ticket-search-hint"/);
 assert.equal((html.match(/Search result/g)||[]).length,50);
});
