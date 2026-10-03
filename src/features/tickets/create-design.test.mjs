import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { load } from '../../../tests/helpers/load-module.mjs';
import { renderTicketCreate } from '../../../tests/fixtures/ticket-create.mjs';

test('staff creation groups labeled required fields and preserves routing defaults inside optional disclosure',async()=>{
 const html=await renderTicketCreate();
 assert.equal((html.match(/<h1>/g)||[]).length,1);
 assert.match(html,/aria-labelledby="request-details-heading"/);
 assert.match(html,/aria-labelledby="request-context-heading"/);
 assert.match(html,/<input[^>]*id="title"[^>]*required=""[^>]*minLength="3"[^>]*maxLength="180"[^>]*aria-describedby="ticket-title-hint"/);
 assert.match(html,/<textarea[^>]*id="description"[^>]*required=""[^>]*maxLength="20000"[^>]*aria-describedby="ticket-description-hint"/);
 assert.match(html,/<details class="ticket-create-routing">/);
 for(const name of ['requesterId','priority','categoryId','subcategoryId','locationId','teamId','assignedTechnicianId','dueAt'])assert.ok(html.includes(`name="${name}"`),name);
 assert.match(html,/<option value="automatic" selected="">/);
 assert.match(html,/<option value="normal" selected="">/);
 assert.match(html,/<option value="worker" selected="">/);
 assert.match(html,/SLA targets are calculated separately/);
 assert.match(html,/photos and files after creating the ticket/);
});

test('employee creation stays simple and equipment context retains its submitted identifier',async()=>{
 const employee=await renderTicketCreate({role:'end_user'});
 for(const name of ['requesterId','priority','teamId','assignedTechnicianId','dueAt'])assert.ok(!employee.includes(`name="${name}"`),name);
 assert.match(employee,/Category \(optional\)/);assert.match(employee,/Open ticket/);
 const equipment=await renderTicketCreate({role:'end_user',params:{asset:'asset'}});
 assert.match(equipment,/type="hidden" name="assetId" value="asset"/);
 assert.match(equipment,/Work laptop/);assert.match(equipment,/LT-1042/);
 assert.doesNotMatch(equipment,/name="locationId"/);
});

test('creation guards pending lookup data, tolerates knowledge failure and escapes feedback',async()=>{
 const html=await renderTicketCreate({errors:['ticket_categories','knowledge_articles'],params:{error:'<script>error</script>'}});
 assert.match(html,/name="lookupLoadError" value="true"/);
 assert.match(html,/Loading choices/);
 assert.match(html,/Suggestions are unavailable. You can still submit your request./);
 assert.match(html,/role="alert"/);assert.match(html,/&lt;script&gt;error&lt;\/script&gt;/);
});

function cancelCase({draft='',confirmed=false,modified=false,pending=false}={}) {
 let prompts=0,prevented=false,focused=false;
 const {TicketDraftCancel}=load('src/features/tickets/ticket-draft-cancel.tsx',{'next/link':{default:()=>null},react:{...React,useContext:()=>pending}});
 globalThis.window={confirm:()=>{prompts++;return confirmed;}};
 try{
  const tree=TicketDraftCancel({href:'/app/tickets'});
  tree.props.onClick({button:0,ctrlKey:modified,currentTarget:{focus:()=>{focused=true;},closest:()=>({querySelector:()=>({value:draft})})},preventDefault:()=>prevented=true});
  return {prompts,prevented,focused,disabled:tree.props['aria-disabled']};
 }finally{delete globalThis.window;}
}
test('cancel protects written drafts, permits confirmed/empty/new-tab navigation and blocks exit while saving',()=>{
 assert.deepEqual(cancelCase({draft:'Unsaved request'}),{prompts:1,prevented:true,focused:true,disabled:undefined});
 assert.equal(cancelCase({draft:'Unsaved',confirmed:true}).prevented,false);
 assert.equal(cancelCase().prompts,0);
 assert.equal(cancelCase({draft:'Unsaved',modified:true}).prompts,0);
 assert.deepEqual(cancelCase({draft:'Unsaved',pending:true}),{prompts:0,prevented:true,focused:false,disabled:true});
});
