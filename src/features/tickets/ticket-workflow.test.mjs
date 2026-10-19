import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
const props={status:'open',assigned:false,review:React.createElement('input',{defaultValue:'Review draft'}),assignment:'Assignment controls',conversation:React.createElement('textarea',{defaultValue:'Unsent response'}),resolution:'Resolve controls',tools:'Company tools',activeWorkflow:false,history:'History'};
test('ticket wizard exposes four named steps and one active panel with contextual navigation',()=>{
 const {TicketWorkflow}=load('src/features/tickets/ticket-workflow.tsx');
 for(const [status,assigned,step]of [['open',false,1],['open',true,2],['in_progress',true,3],['resolved',true,4]]){
  const html=renderToStaticMarkup(React.createElement(TicketWorkflow,{...props,status,assigned}));
  assert.match(html,/aria-label="Ticket workflow"/);assert.match(html,new RegExp(`Step ${step} of 4`));
  assert.equal((html.match(/aria-current="step"/g)||[]).length,1);assert.equal((html.match(/ hidden=""/g)||[]).length,3);
  assert.match(html,/Unsent response/);assert.match(html,/Review draft/);
  assert.match(html,/Optional procedures &amp; incident tools/);
 }
});
test('wizard navigation retains every panel and updates the shareable step without submitting ticket data',()=>{
 let value,cursor=0;const slots=[],refs=[];
 const hooks={...React,useEffect(){},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],next=>slots[index]=next];},useRef(initial){const index=cursor++;return refs[index]??={current:initial};}};
 const {TicketWorkflow}=load('src/features/tickets/ticket-workflow.tsx',{react:hooks});
 const walk=(node,p)=>{if(Array.isArray(node))return node.flatMap(n=>walk(n,p));if(!React.isValidElement(node))return[];return [...(p(node)?[node]:[]),...walk(node.props.children,p)];};
 const old=globalThis.window;globalThis.window={history:{state:{queue:'mine'},replaceState:(_state,_title,hash)=>value=hash}};
 try{
  const render=()=>{cursor=0;return TicketWorkflow(props);};let tree=render();
  walk(tree,n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.join('')==='Next: Assign & start')[0].props.onClick();tree=render();
  assert.equal(value,'#ticket-assignment');assert.equal(walk(tree,n=>n.type==='section'&&!n.props.hidden)[0].props.id,'ticket-assignment');
  assert.equal(walk(tree,n=>n.type==='section').length,4);
  assert.equal(walk(tree,n=>n.type==='textarea')[0].props.defaultValue,'Unsent response');
  assert.ok(walk(tree,n=>n.type==='button').every(n=>n.props.type==='button'));
 }finally{globalThis.window=old;}
});

test('saved-details recovery links activate Assignment even when a working ticket normally opens Respond',()=>{
 const previous=globalThis.window;let listener,removed,step,effects=[];
 globalThis.window={location:{hash:'#ticket-details'},addEventListener:(name,handler)=>{if(name==='hashchange')listener=handler;},removeEventListener:(name,handler)=>removed=[name,handler]};
 const {TicketWorkflow}=load('src/features/tickets/ticket-workflow.tsx',{react:{...React,useState:initial=>{step??=initial;return[step,next=>step=next];},useRef:initial=>({current:initial}),useEffect:fn=>effects.push(fn)}});
 try{
  TicketWorkflow({...props,status:'in_progress',assigned:true});assert.equal(step,2);
  const cleanup=effects[0]();assert.equal(step,1);
  globalThis.window.location.hash='#ticket-resolution';listener();assert.equal(step,3);
  globalThis.window.location.hash='#ticket-details';listener();assert.equal(step,1);
  cleanup();assert.deepEqual(removed,['hashchange',listener]);
 }finally{globalThis.window=previous;}
});
