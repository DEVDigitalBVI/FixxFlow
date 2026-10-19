import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
import {load} from '../../../tests/helpers/load-module.mjs';
const initial={id:'ticket',revision:1,status:'open',assigned_technician_id:null};
const mocks={'next/navigation':{useRouter:()=>({refresh(){}})},'@/app/app/tickets/actions':{workTicket:async()=>({success:'Saved',revision:2})},'@/components/ui/action-form':{ActionForm:({children})=>React.createElement('form',null,children)},'@/components/ui/submit-button':{SubmitButton:({children})=>React.createElement('button',null,children)}};
test('staff work controls show actions appropriate to unassigned, working and resolved tickets',()=>{
 const {TicketWorkActions}=load('src/features/tickets/work-actions.tsx',mocks);
 for(const [ticket,present,absent]of [[initial,['Assign to me','Update status'],['Start work','Mark resolved']],[{...initial,assigned_technician_id:'worker'},['Start work','Mark resolved'],['Assign to me']],[{...initial,status:'in_progress',assigned_technician_id:'worker'},['Mark resolved'],['Start work']],[{...initial,status:'resolved'},['reopen this ticket','Update status'],['Assign to me','Start work','Mark resolved']]]){
  const html=renderToStaticMarkup(React.createElement(TicketWorkActions,{ticket,assignee:'Unassigned'}));
  for(const text of present)assert.ok(html.includes(text),text);for(const text of absent)assert.ok(!html.includes(text),text);
  assert.match(html,/href="#ticket-conversation"/);assert.match(html,/<label>Status<select/);
 }
});
test('background updates preserve a changed status draft; explicit review adopts the new revision',async()=>{
 const props={ticket:initial,assignee:'Unassigned'},h=componentHarness('src/features/tickets/work-actions.tsx','TicketWorkActions',props,mocks);
 try{
  h.find(n=>n.type==='select').props.onChange();h.render();
  props.ticket={...initial,revision:2,assigned_technician_id:'someone'};h.render();
  assert.equal(h.all(n=>n.props.name==='intent').length,0);
  h.find(n=>n.type==='button').props.onClick();h.render();
  assert.equal(h.find(n=>n.props.name==='revision').props.value,2);
  const form=h.find(n=>typeof n.props.action==='function');await form.props.action(new FormData());h.render();
  assert.equal(h.find(n=>n.props.name==='revision').props.value,2);
 }finally{h.close();}
});
