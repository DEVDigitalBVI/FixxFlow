import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { administrationSections, fixedSlaTargets, formatMinutes } from './sections.ts';
const require = createRequire(import.meta.url);
function load(file, role, rows = [], error = null) {
  const calls = [];
  const builder = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({data: rows, error}).then(resolve) : (...args) => { calls.push([key, ...args]); return builder; } });
  const mocks = {
    '@/features/identity/role': {rolePresentation:{technician:{label:'Technician'},end_user:{label:'End User'},administrator:{label:'Administrator'}}},
    './actions': {inviteMember:async()=>{},updateMemberRole:async()=>{},updateMemberStatus:async()=>{}},
    '@/components/ui/avatar': {Avatar:()=>null},
    '@/components/ui/submit-button': {SubmitButton:(props)=>{const buttonProps={...props};delete buttonProps.pendingLabel;return React.createElement('button',buttonProps);}},
    'next/link': {default: props => React.createElement('a', props)},
    'next/navigation': {notFound: () => { throw new Error('NOT_FOUND'); }},
    '@/lib/auth/viewer': {requireViewer: async () => ({role, organizationId:'org', organizationName:'Workspace'})},
    '@/lib/supabase/server': {createClient: async () => { calls.push(['client']); return {from: table => {calls.push(['from',table]); return builder;}}; }},
    '@/features/administration/sections': {administrationSections, fixedSlaTargets, formatMinutes},
    '@/features/tickets/presentation': {ticketPriorities:Object.fromEntries(fixedSlaTargets.map(t=>[t.priority,{label:t.priority}])),activityLabels:{created:'created the ticket'},formatTicketDate:v=>v},
  };
  const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const m={exports:{}}; new Function('require','module','exports',compiled)(n=>mocks[n]??require(n),m,m.exports);
  return {render:m.exports.default,calls};
}
const hub='src/app/app/administration/page.tsx';
const detail='src/app/app/administration/[section]/page.tsx';
const props=(section,page='1')=>({params:Promise.resolve({section}),searchParams:Promise.resolve({page})});
test('administration groups related settings and keeps future features out of active navigation',async()=>{
  const html=renderToStaticMarkup(await load(hub,'administrator').render());
  for(const href of ['/app/organization','/app/organization#departments','/app/organization#locations','/app/people','/app/people?view=technicians','/app/help?view=all','/app/administration/slas']) assert.ok(html.includes(`href="${href}"`));
  assert.match(html,/People &amp; access/);assert.match(html,/Priorities &amp; SLAs/);
  assert.doesNotMatch(html,/href="\/app\/administration\/(priorities|assets)"/);
  assert.match(html,/<summary>Coming later<\/summary>/);assert.match(html,/Read only/);
});
test('non-administrators cannot render the hub or directly request data sections',async()=>{
  for(const role of ['end_user','technician']) for(const file of [hub,detail]) {
    const {render,calls}=load(file,role);await assert.rejects(()=>render(props('audit-log')),/NOT_FOUND/);assert.deepEqual(calls,[]);
  }
});
test('audit log scopes and paginates reads without exposing raw event details',async()=>{
  const rows=Array.from({length:51},(_,id)=>({id,ticket_id:'ticket',action:'created',created_at:'2026-09-25T00:00:00Z',details:'private raw payload'}));
  const {render,calls}=load(detail,'administrator',rows);
  const html=renderToStaticMarkup(await render(props('audit-log','2')));
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='org'));
  assert.ok(calls.some(c=>c[0]==='range'&&c[1]===50&&c[2]===100));
  assert.equal((html.match(/View ticket/g)||[]).length,50);assert.match(html,/page=3/);assert.doesNotMatch(html,/private raw payload/);
});
test('settings distinguish failed queries from an empty list',async()=>{
  await assert.rejects(()=>load(detail,'administrator',null,{message:'failed'}).render(props('teams')),/Unable to load/);
  assert.match(renderToStaticMarkup(await load(detail,'administrator',[]).render(props('teams'))),/No teams found/);
});
test('fixed SLA presentation matches the database deadline function',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260925004643_ticket_sla_targets.sql','utf8');
  for(const target of fixedSlaTargets) assert.ok(sql.includes(`when '${target.priority}' then case when response then ${target.response} else ${target.resolution} end`));
});

test('technician view filters memberships on the server and defaults invitations to technician',async()=>{
  const {render,calls}=load('src/app/app/people/page.tsx','administrator');
  const html=renderToStaticMarkup(await render({searchParams:Promise.resolve({view:'technicians'})}));
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='role'&&c[2]==='technician'));
  assert.match(html,/<h1>Technicians<\/h1>/);
  assert.match(html,/<option value="technician" selected="">/);
});
