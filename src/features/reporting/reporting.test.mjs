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

const reportFixture = {
 asOf: '2026-10-01T16:00:00Z', timezone: 'America/Tortola', today: '2026-10-01',
 summary: { created: 4, resolved: 2, open: 7, overdue: 1, response: 18, resolution: 120 },
 daily: [{ day: '2026-10-01', created: 4, resolved: 2, reopened: 0, response: 18, resolution: 120 }],
 breakdowns: [], sla: [{ label: 'First response', total: 4, met: 3 }, { label: 'Resolution', total: 2, met: 2 }],
};
const reportComponents = () => load('src/features/reporting/components.tsx', {
 'next/link': { default: props => React.createElement('a', props) }, './model': { duration, topRows },
});

test('service levels distinguish historical compliance from current breached work and provide useful buttons', () => {
 const { ServiceLevels } = reportComponents();
 const html = renderToStaticMarkup(React.createElement(ServiceLevels, { report: reportFixture, canViewTargets: true }));
 assert.match(html, /75.0%/); assert.match(html, /100.0%/);
 assert.match(html, /3 of 4 completed targets met on time/);
 assert.match(html, /Last 30 days/); assert.match(html, /Right now/);
 assert.match(html, /open ticket past an SLA deadline/);
 assert.match(html, /class="button button-secondary" href="\/app\/tickets\?view=all&amp;sla=breached&amp;sort=sla"/);
 assert.match(html, /href="\/app\/administration\/slas">View SLA targets/);
});

test('no completed SLA samples is not displayed as zero or perfect compliance; technicians have no admin shortcut', () => {
 const { ServiceLevels } = reportComponents();
 for (const sla of [[], [{ label: 'Resolution', total: 0, met: 0 }]]) {
  const html = renderToStaticMarkup(React.createElement(ServiceLevels, { report: { ...reportFixture, sla, summary: { ...reportFixture.summary, overdue: 0 } } }));
  assert.match(html, /No completed targets yet/);
  assert.match(html, /No open tickets are past/);
  assert.doesNotMatch(html, /NaN|Infinity|100\.0%|0\.0%|\/administration\//);
  assert.match(html, /Review breached tickets/);
 }
});

test('report groups label distinct periods and preserve all trend and breakdown views', () => {
 const { ReportCharts } = reportComponents();
 const html = renderToStaticMarkup(React.createElement(ReportCharts, { report: reportFixture }));
 for (const heading of ['Activity &amp; turnaround', 'Current workload', 'Where requests come from']) assert.ok(html.includes(heading));
 assert.match(html, /All unresolved tickets right now, regardless of when they were created/);
 assert.match(html, /href="\/app\/tickets\?view=unassigned"/);
 assert.equal((html.match(/<h3>/g) ?? []).length, 9);
 assert.equal((html.match(/<details>/g) ?? []).length, 4);
 assert.doesNotMatch(html, /SLA compliance/);
});

test('reports page passes administrator-only SLA navigation without altering technician report access', async () => {
 for (const role of ['administrator', 'technician']) {
  const page = load('src/app/app/reports/page.tsx', {
   'next/link': { default: props => React.createElement('a', props) },
   'next/navigation': { notFound: () => { throw Error('NOT_FOUND'); } },
   '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'org', organizationName: 'Workspace' }) },
   '@/features/reporting/data': { getReport: async () => reportFixture },
   '@/features/reporting/report-download': { ReportDownload: () => React.createElement('button', {}, 'Download report') },
  }).default;
  const html = renderToStaticMarkup(await page());
  assert.match(html, /At a glance/); assert.match(html, /Download report/);
  assert.equal(html.includes('href="/app/administration/slas"'), role === 'administrator');
 }
});
