import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { normalizeQueueFilters } = load('src/features/tickets/queue-filters.ts');
function setup(role = 'technician', count = 51) {
 const calls=[];
 const rows=Array.from({length:count},(_,i)=>({id:String(i),title:'Search result',ticket_number:i,status:'open',priority:'normal',updated_at:'2026-09-25T00:00:00Z'}));
 const builder=(data)=>new Proxy({}, {get:(_,key)=>key==='then' ? (resolve)=>Promise.resolve({data,error:null}).then(resolve) : (...args)=>{calls.push([key,...args]);return builder(data);}});
 const mocks={
  'next/navigation':searchNavigation,
  'server-only':{},
  '@/features/product-analytics/usage-event':{UsageEvent:()=>null},
  '@/features/tickets/bulk-actions':{BulkActions:({children})=>children},
  'next/link':{default:props=>React.createElement('a',props)},
  '@/lib/auth/viewer':{requireViewer:async()=>({id:'staff',organizationId:'org',role})},
  '@/lib/supabase/server':{createClient:async()=>({rpc:(...args)=>{calls.push(['rpc',...args]);return builder(rows);},from:table=>{calls.push(['from',table]);return builder([]);}})},
  '@/features/tickets/conversation-refresh':{ConversationRefresh:()=>null},
  '@/features/tickets/sla-indicator':{SlaClock:({children})=>children,SlaIndicator:()=>null},
  '@/features/tickets/presentation':{formatTicketDate:x=>x,ticketStatuses:{open:{label:'Open'}},ticketPriorities:{normal:{label:'Normal'}}},
  '@/features/tickets/bulk-select-all':{BulkSelectAll:()=>null},
  '@/features/tickets/queue-filters':{normalizeQueueFilters},
  './queue-filters':{normalizeQueueFilters},
  './actions':{bulkUpdateTickets:async()=>{}},
 };
 const { default: Page } = load('src/app/app/tickets/page.tsx', mocks);
 return { calls, Page };
}
test('ticket search calls the permission-scoped RPC and preserves filters in pagination',async()=>{
 const { calls, Page } = setup();
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({q:'VPN error 809',status:'open',page:'2'})}));
 assert.deepEqual(calls.find(c=>c[0]==='rpc'),['rpc','search_tickets',{target_organization_id:'org',search_text:'VPN error 809'}]);
 assert.ok(calls.some(c=>c[0]==='range'&&c[1]===50&&c[2]===100));
 assert.match(html,/q=VPN\+error\+809&amp;status=open&amp;page=3/);
 assert.match(html,/aria-label="Ticket pages"/);
 assert.match(html,/aria-describedby="ticket-search-hint"/);
 assert.equal((html.match(/Search result/g)||[]).length,50);
});

test('employee ticket lists do not fetch staff-only lookup data', async () => {
 const { calls, Page } = setup('end_user');
 const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
 assert.match(html, /My requests/);
 assert.deepEqual(calls.filter(call => call[0] === 'from'), [['from', 'tickets']]);
 assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'requester_id' && call[2] === 'staff'));
 assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org'));
});


test('employee requests use one panel, optional search tips, and no single-page pagination', async () => {
 const { Page } = setup('end_user', 1);
 const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'VPN', kind: 'inventory' }) }));
 assert.match(html, /class="page-header"/);
 assert.match(html, /class="employee-requests-panel" aria-label="Requests"/);
 assert.match(html, /<details class="employee-request-search-help"><summary>Search tips<\/summary>/);
 assert.match(html, /aria-describedby="ticket-search-hint"/);
 assert.match(html, /name="kind" value="inventory"/);
 assert.match(html, /href="\/app\/tickets\?kind=inventory">Clear search/);
 assert.match(html, /href="\/app\/tickets\?kind=inventory&amp;q=VPN"/);
 assert.doesNotMatch(html, /aria-label="Ticket pages"|← Home|See updates, read replies/);
 assert.equal((html.match(/Results update as you type/g) ?? []).length, 1);
 assert.match(html, /data-queue-ticket="0"/);
});

test('employee request empty states distinguish equipment and search results', async () => {
 const { Page } = setup('end_user', 0);
 for (const [filters, title] of [[{}, 'No requests yet'], [{kind:'inventory'}, 'No equipment requests yet'], [{q:'missing'}, 'No matching requests']]) {
  const html = renderToStaticMarkup(await Page({searchParams:Promise.resolve(filters)}));
  assert.ok(html.includes(title));
  assert.equal((html.match(/href="\/app\/tickets\/new"/g) ?? []).length, 1);
 }
});

test('incident queue filtering uses the tenant-scoped ticket source and survives paging and filter removal',async()=>{
 const {calls,Page}=setup();
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({type:'incident',q:'outage',page:'2'})}));
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='ticket_type'&&c[2]==='incident'));
 assert.match(html,/q=outage&amp;type=incident&amp;page=3/);
 assert.match(html,/name="type"/);assert.match(html,/Incident tickets/);
});
