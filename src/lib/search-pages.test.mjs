import { searchNavigation } from '../../tests/helpers/search-navigation.mjs';
import {load} from '../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

function setup(file,{role='administrator',rows=[],count=60,error=null}={}) {
 const calls=[];
 const builder=source=>new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:rows,count,error}).then(resolve):(...args)=>{calls.push([source,key,...args]);return builder(source);}});
 const db={from:table=>{calls.push(['from',table]);return builder(table);},rpc:(...args)=>{calls.push(['rpc',...args]);return builder(args[0]);}};
 const mocks={
  'next/link':{default:p=>React.createElement('a',p)},
  'next/navigation':{...searchNavigation,notFound:()=>{throw Error('NOT_FOUND');}},
  '@/lib/auth/viewer':{requireViewer:async()=>({id:'employee',organizationId:'org',organizationName:'Workspace',role})},
  '@/lib/supabase/server':{createClient:async()=>db},
  '@/components/ui/submit-button':{SubmitButton:p=>React.createElement('button',{type:p.type??'submit',className:p.className},p.children)},
  '@/features/administration/member-details-editor':{MemberDetailsEditor:()=>null},
  '@/features/assets/ticket-link-form':{AssetLinkForm:()=>null},
  '@/features/product-analytics/usage-event':{UsageEvent:()=>null},
  './actions':{inviteMember:()=>{},updateMemberRole:()=>{},updateMemberStatus:()=>{}},
 };
 return {calls,render:async params=>renderToStaticMarkup(await load(file,mocks).default({searchParams:Promise.resolve(params)}))};
}
test('asset search uses a scoped RPC, exact counts and stable pagination while preserving filters',async()=>{
 const a=setup('src/app/app/assets/page.tsx',{rows:[{id:'asset',name:'Reception',tag:'PC-1',kind:'computer',status:'repair',serial_number:'1234567890',model:'HP 850'}]});
 const html=await a.render({q:'  HP\t12345 ',status:'repair',page:'2'});
 assert.deepEqual(a.calls.find(c=>c[0]==='rpc'),['rpc','search_assets',{target_organization_id:'org',search_text:'HP 12345'},{count:'exact'}]);
 assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='organization_id'&&c[3]==='org'));
 assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='status'&&c[3]==='repair'));
 assert.ok(a.calls.some(c=>c[1]==='range'&&c[2]===25&&c[3]===49));
 assert.match(html,/q=HP\+12345&amp;status=repair&amp;page=3/);
 assert.match(html,/data-label="Serial number">1234567890/);
 assert.match(html,/role="search"/);assert.match(html,/aria-describedby="asset-search-hint"/);
 assert.match(html,/type="search"/);assert.match(html,/maxLength="200"/);assert.match(html,/Clear filters/);
 assert.doesNotMatch(html,/name="page"/);
});
test('asset empty results and failures retain recovery, and employee queries retain assignment scope',async()=>{
 const empty=setup('src/app/app/assets/page.tsx',{role:'end_user',count:0});
 const html=await empty.render({q:'missing'});
 assert.ok(empty.calls.some(c=>c[1]==='eq'&&c[2]==='assigned_user_id'&&c[3]==='employee'));
 assert.match(html,/No matching assets/);assert.match(html,/shorter name or serial-number fragment/);
 const failed=setup('src/app/app/assets/page.tsx',{error:{message:'offline'}});
 assert.match(await failed.render({q:'12345'}),/role="alert"/);
 const blank=setup('src/app/app/assets/page.tsx');await blank.render({q:['one','two']});
 assert.ok(!blank.calls.some(c=>c[0]==='rpc'));
});
test('inventory keeps complete long values, semantic headers and mobile labels in a keyboard-accessible region',async()=>{
 const serial='VMware-42 04 a7 ff 60 3d 6f f7-25 fa c1 5a d3 22 c3 5b';
 const model='HP EliteBook 865 16 inch G11 Notebook PC';
 const a=setup('src/app/app/assets/page.tsx',{rows:[{id:'asset',name:'Reception workstation',tag:'PC-001 (HOUSE KEEPING SUPERVISORS)',kind:'network',status:'repair',serial_number:serial,model}]});
 const html=await a.render({});
 assert.match(html,/role="region" aria-label="Asset inventory" tabindex="0"/);
 for(const label of ['Asset','Serial number','Type','Lifecycle','Model']) {
  assert.ok(html.includes(`<th scope="col">${label}</th>`));
  assert.ok(html.includes(`data-label="${label}"`));
 }
 for(const value of [serial,model,'Network equipment','Under repair','PC-001 (HOUSE KEEPING SUPERVISORS)']) assert.ok(html.includes(value));
});
test('people and technician searches preserve punctuation and filter roles before pagination',async()=>{
 const a=setup('src/app/app/people/page.tsx');
 const html=await a.render({q:"  O'Neil  syst ",view:'technicians',page:'2'});
 assert.deepEqual(a.calls.find(c=>c[0]==='rpc'),['rpc','search_members',{target_organization_id:'org',search_text:"O'Neil syst"},{count:'exact'}]);
 assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='role'&&c[3]==='technician'));
 assert.ok(a.calls.some(c=>c[1]==='range'&&c[2]===25&&c[3]===49));
 assert.match(html,/q=O%27Neil\+syst&amp;view=technicians/);
 assert.match(html,/aria-describedby="people-search-hint"/);assert.match(html,/Search name, email or job title/);
});
test('knowledge search shares normalization and keeps employee searches published-only',async()=>{
 const a=setup('src/app/app/help/page.tsx',{role:'end_user'});
 const html=await a.render({q:'  adap\nVPN  ',view:'all',category:'Network',page:'2'});
 assert.deepEqual(a.calls.find(c=>c[0]==='rpc'),['rpc','search_knowledge_articles',{target_organization_id:'org',search_text:'adap VPN'}]);
 assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='status'&&c[3]==='published'));
 assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='category'&&c[3]==='Network'));
 assert.match(html,/q=adap\+VPN&amp;category=Network&amp;view=published&amp;page=1/);
 assert.match(html,/aria-describedby="knowledge-search-hint"/);
});
test('platform search shares normalization, preserves pages and checks owner access first',async()=>{
 const calls=[];const report={organizations:[],organizationCount:30,matchingCount:30,usage:[],audit:[]};
 const {PlatformDashboard}=load('src/features/platform/dashboard.tsx',{
  'next/navigation':searchNavigation,
  'next/link':{default:p=>React.createElement('a',p)},
  '@/lib/auth/platform':{requirePlatformOwner:async()=>{calls.push(['owner']);}},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(...args)=>{calls.push(['rpc',...args]);return {data:report,error:null};}})},
  './customer-form':{CustomerForm:()=>null},
 });
 const html=renderToStaticMarkup(await PlatformDashboard({section:'customers',searchParams:Promise.resolve({q:'  Lab\t100% ',page:'2'})}));
 assert.deepEqual(calls,[['owner'],['rpc','platform_overview',{search_text:'Lab 100%',page_number:2,days:30}]]);
 assert.match(html,/q=Lab\+100%25&amp;page=1/);assert.match(html,/aria-describedby="organization-search-hint"/);assert.match(html,/Clear search/);
});
