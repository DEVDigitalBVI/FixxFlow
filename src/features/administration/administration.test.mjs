import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';
import { load as loadModule } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { administrationSections, fixedSlaTargets, formatMinutes } = loadModule('src/features/administration/sections.ts');
function load(file, role, rows = [], error = null) {
  const calls = [];
  const builder = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({data: rows, error}).then(resolve) : (...args) => { calls.push([key, ...args]); return builder; } });
  const mocks = {
    '@/features/administration/classification-editor': {ClassificationEditor:()=>null},
    '@/features/administration/member-details-editor': {MemberDetailsEditor:()=>null},
    '@/features/audit/audit-log': {AuditLog:()=>null},
    '@/features/identity/role': {rolePresentation:{technician:{label:'Technician'},end_user:{label:'End User'},administrator:{label:'Administrator'}}},
    './actions': {inviteMember:async()=>{},updateMemberRole:async()=>{},updateMemberStatus:async()=>{}},
    '@/components/ui/avatar': {Avatar:()=>null},
    '@/components/ui/submit-button': {SubmitButton:(props)=>{const buttonProps={...props};delete buttonProps.pendingLabel;return React.createElement('button',buttonProps);}},
    'next/link': {default: props => React.createElement('a', props)},
    'next/navigation': {...searchNavigation,notFound: () => { throw new Error('NOT_FOUND'); }},
    '@/lib/auth/viewer': {requireViewer: async () => ({role, organizationId:'org', organizationName:'Workspace'})},
    '@/lib/supabase/server': {createClient: async () => { calls.push(['client']); return {from: table => {calls.push(['from',table]); return builder;}}; }},
    '@/features/administration/sections': {administrationSections, fixedSlaTargets, formatMinutes},
    '@/features/tickets/presentation': {ticketPriorities:Object.fromEntries(fixedSlaTargets.map(t=>[t.priority,{label:t.priority}])),activityLabels:{created:'created the ticket'},formatTicketDate:v=>v},
  };
  return { render: loadModule(file, mocks).default, calls };
}
const hub='src/app/app/administration/page.tsx';
const detail='src/app/app/administration/[section]/page.tsx';
const props=(section,page='1')=>({params:Promise.resolve({section}),searchParams:Promise.resolve({page})});
test('administration groups related settings and keeps future features out of active navigation',async()=>{
  const html=renderToStaticMarkup(await load(hub,'administrator').render());
  for(const href of ['/app/organization','/app/organization#departments','/app/organization#locations','/app/people','/app/people?view=technicians','/app/help?view=all','/app/administration/slas']) assert.ok(html.includes(`href="${href}"`));
  assert.match(html,/People &amp; access/);assert.match(html,/Priorities &amp; SLAs/);
  assert.doesNotMatch(html,/href="\/app\/administration\/(priorities|assets)"/);
  assert.match(html,/href="\/app\/assets"/);assert.ok(administrationSections.filter(item => ['teams','categories'].includes(item.slug)).every(item => item.status === 'Available'));
});
test('non-administrators cannot render the hub or directly request data sections',async()=>{
  for(const role of ['end_user','technician']) for(const file of [hub,detail]) {
    const {render,calls}=load(file,role);await assert.rejects(()=>render(props('audit-log')),/NOT_FOUND/);assert.deepEqual(calls,[]);
  }
});
test('settings distinguish failed queries from an empty list',async()=>{
  await assert.rejects(()=>load(detail,'administrator',null,{message:'failed'}).render(props('teams')),/Unable to load/);
  assert.match(renderToStaticMarkup(await load(detail,'administrator',[]).render(props('teams'))),/No teams found/);
});
test('fixed SLA presentation matches the database deadline function',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260925004643_ticket_sla_targets.sql','utf8');
  for(const target of fixedSlaTargets) assert.ok(sql.includes(`when '${target.priority}' then case when response then ${target.response} else ${target.resolution} end`));
});

test('email status uses Zoho dispatcher readiness without exposing credentials', async () => {
  const environment = {
    ZOHO_CPAAS_API_KEY: 'fixture-provider-secret', NOTIFICATIONS_FROM_EMAIL: 'support@example.test',
    NEXT_PUBLIC_SITE_URL: 'https://app.example.test', CRON_SECRET: 'fixture-cron-secret',
    SUPABASE_SECRET_KEY: 'fixture-database-secret', RESEND_API_KEY: 'fixture-legacy-secret',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const render = async () => renderToStaticMarkup(await load(detail, 'administrator').render(props('notifications')));
    const configured = await render();
    assert.match(configured, /Zoho configured; delivery depends on provider availability/);
    assert.match(configured, /href="\/app\/notifications"/);
    for (const value of Object.values(environment)) assert.ok(!configured.includes(value));
    for (const key of Object.keys(environment).filter(key => key !== 'RESEND_API_KEY')) {
      delete process.env[key];
      assert.match(await render(), /Zoho setup incomplete/);
      process.env[key] = environment[key];
    }
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    assert.match(await render(), /Zoho setup incomplete/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('technician view filters memberships on the server and defaults invitations to technician',async()=>{
  const {render,calls}=load('src/app/app/people/page.tsx','administrator');
  const html=renderToStaticMarkup(await render({searchParams:Promise.resolve({view:'technicians',invite:'1'})}));
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='role'&&c[2]==='technician'));
  assert.match(html,/<h1>Technicians<\/h1>/);
  assert.match(html,/<option value="technician" selected="">/);
});

test('Administration landing navigation uses named button-style links and clear section landmarks',async()=>{
  const html=renderToStaticMarkup(await load(hub,'administrator').render());
  const links=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.ok(links.length>=15);
  for(const [,attributes,label] of links){assert.match(attributes,/class="button /);assert.match(attributes,/href="/);assert.ok(label.trim());assert.doesNotMatch(attributes,/role="button"/);}
  assert.equal((html.match(/<h1>/g)??[]).length,1);
  for(const id of ['workspace','support','governance']){
    assert.ok(html.includes(`href="#admin-${id}"`));assert.ok(html.includes(`aria-labelledby="admin-${id}-heading"`));
  }
  for(const action of ['Manage automations','Manage assets','Teams','Categories','View SLA targets','View notification setup','Security settings','Audit log','Write an article'])assert.ok(html.includes(action),action);
  assert.doesNotMatch(html,/cannot be edited yet/);
  assert.match(html,/Fixed targets/);
});
