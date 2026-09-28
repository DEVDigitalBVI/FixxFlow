import { load } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {duration,topRows} from './model.ts';

test('duration distinguishes no samples, sub-minute responses, and hours',()=>{
 assert.equal(duration(null),'No data');assert.equal(duration(0),'<1m');assert.equal(duration(18),'18m');assert.equal(duration(192),'3.2h');
});
test('top categories preserve totals when grouping the tail',()=>{
 const rows=Array.from({length:15},(_,i)=>({label:`Group ${i}`,value:i+1}));const result=topRows(rows);
 assert.equal(result.length,11);assert.equal(result.at(-1).label,'Other groups');assert.equal(result.reduce((n,r)=>n+r.value,0),120);
});
test('employee cannot request reports and failures never masquerade as zeros',async()=>{
 let calls=0;
 const mocks={'next/link':{default:props=>React.createElement('a',props)},'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},'@/lib/auth/viewer':{requireViewer:async()=>({role:'end_user',organizationId:'org'})},'@/features/reporting/data':{getReport:async()=>{calls++;return null;}},'@/features/reporting/components':{ReportUnavailable:()=>React.createElement('div',{role:'alert'},'Unavailable')}};
 const page=()=>load('src/app/app/reports/page.tsx',mocks).default();
 await assert.rejects(page,/NOT_FOUND/);assert.equal(calls,0);
 mocks['@/lib/auth/viewer'].requireViewer=async()=>({role:'technician',organizationId:'org'});
 assert.match(renderToStaticMarkup(await page()),/role="alert"/);assert.equal(calls,1);
});
test('charts provide labeled data tables and distinguish empty timing samples',()=>{
 const {Trend,Bars}=load('src/features/reporting/components.tsx',{'next/link':{default:props=>React.createElement('a',props)},'./model':{duration,topRows}});
 const html=renderToStaticMarkup(React.createElement(Trend,{title:'Response time',description:'Timing',days:['2026-09-24','2026-09-25'],series:[{label:'Response',values:[null,18]}],time:true}));
 assert.match(html,/role="img"/);assert.match(html,/<caption>/);assert.match(html,/scope="row"/);assert.match(html,/No data/);assert.match(html,/18m/);
 assert.match(html,/Response time over 2 days/);
 const empty=renderToStaticMarkup(React.createElement(Bars,{title:'SLA compliance',description:'Completed targets',rows:[],percent:true}));assert.match(empty,/No completed SLA/);assert.doesNotMatch(empty,/100%/);
});

test('daily report details start collapsed and preserve every date and zero in a labeled keyboard scroll region',()=>{
 const {Trend}=load('src/features/reporting/components.tsx',{'next/link':{default:props=>React.createElement('a',props)},'./model':{duration,topRows}});
 const days=Array.from({length:30},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`);
 const html=renderToStaticMarkup(React.createElement(Trend,{title:'Reopened tickets',description:'Daily reopens',days,series:[{label:'Reopened',values:days.map(()=>0)}]}));
 assert.match(html,/<details><summary>View data for reopened tickets · 30 days<\/summary>/);
 assert.doesNotMatch(html,/<details[^>]*\bopen(?:\s|=|>)/);
 assert.match(html,/role="region" aria-label="Reopened tickets data" tabindex="0"/);
 assert.match(html,/<th scope="col">Date<\/th><th scope="col">Reopened<\/th>/);
 assert.equal((html.match(/<th scope="row">/g)??[]).length,30);
 assert.equal((html.match(/<td>0<\/td>/g)??[]).length,30);
 for(const day of days)assert.ok(html.includes(day));
 assert.match(html,/No activity in this period/);
 assert.doesNotMatch(html,/<svg|No data/);
});

test('overview returns its navigation before metrics resolve and preserves report failure feedback', async () => {
 let finish;
 const pending = new Promise(resolve => { finish = resolve; });
 const page = load('src/app/app/page.tsx', {
  'next/link': { default: props => React.createElement('a', props) },
  '@/lib/auth/viewer': { requireViewer: async () => ({ role: 'technician', organizationId: 'org', organizationName: 'Workspace' }) },
  '@/lib/supabase/server': { createClient: () => { throw Error('Staff overview should not create an unused client'); } },
  '@/features/reporting/data': { getReport: organizationId => { assert.equal(organizationId, 'org'); return pending; } },
  '@/features/reporting/components': { ReportUnavailable: () => React.createElement('div', { role: 'alert' }, 'Unavailable'), TodayMetrics: props => React.createElement('div', { role: props.report ? undefined : 'status' }, 'Metrics') },
 }).default;
 const tree = await page();
 const children = React.Children.toArray(tree.props.children);
 const boundary = children.find(child => child.type === React.Suspense);
 assert.ok(boundary);
 assert.match(renderToStaticMarkup(children[0]), /Open ticket queue/);
 assert.match(renderToStaticMarkup(boundary.props.fallback), /role="status"/);
 const metrics = boundary.props.children.type(boundary.props.children.props);
 finish(null);
 assert.match(renderToStaticMarkup(await metrics), /role="alert"/);
});

 test('pending metrics reserve the responsive six-card layout and announce loading', () => {
 const { TodayMetrics } = load('src/features/reporting/components.tsx', {
  'next/link': { default: props => React.createElement('a', props) },
  './model': { duration, topRows },
 });
 const html = renderToStaticMarkup(React.createElement(TodayMetrics, { report: null }));
 assert.match(html, /aria-busy="true"/);
 assert.match(html, /role="status"/);
 assert.match(html, /class="report-metrics"/);
 assert.equal((html.match(/class="settings-card"/g) ?? []).length, 6);
 assert.doesNotMatch(html, /No data/);
});
