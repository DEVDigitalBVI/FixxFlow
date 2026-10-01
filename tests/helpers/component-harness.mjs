import React from 'react';
import {load} from './load-module.mjs';
/** Deterministic component interaction harness. Exercises real handlers/state
 * and focus targets; does not claim browser layout or native keyboard emulation.
 */
export function componentHarness(file,name,props,mocks={}) {
  const slots=[],focuses=[],elements=new Map();let cursor=0,effects=[],tree;
  const slot=init=>{const index=cursor++;if(!(index in slots))slots[index]=init();return index;};
  const effect=(fn,deps)=>{const index=slot(()=>({deps:null}));if(!deps||!slots[index].deps||deps.some((value,i)=>!Object.is(value,slots[index].deps[i]))){slots[index].deps=deps;effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}};
  const hooks={...React,useState:initial=>{const index=slot(()=>typeof initial==='function'?initial():initial);return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef:initial=>slots[slot(()=>({current:initial}))],useCallback:fn=>{slot(()=>null);return fn;},useEffect:effect,useLayoutEffect:effect,useId:()=>`fixture-${slot(()=>null)}`,useTransition:()=>[false,fn=>fn()]};
  const component=load(file,{...mocks,react:hooks})[name];
  const walk=(node,visit)=>{if(Array.isArray(node))node.forEach(item=>walk(item,visit));else if(node&&typeof node==='object'&&node.props){visit(node);walk(node.props.children,visit);}};
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  globalThis.document={getElementById:id=>elements.get(id),addEventListener(){},removeEventListener(){}};
  globalThis.window={addEventListener(){},removeEventListener(){},confirm:()=>true};
  const api={focuses,render(){cursor=0;effects=[];elements.clear();tree=component(props);walk(tree,node=>{const target={focus:()=>focuses.push(node.props.id??node.props['aria-label']??'feedback')};if(node.props.id)elements.set(node.props.id,target);if(node.props.ref&&typeof node.props.ref==='object')node.props.ref.current=target;});effects.forEach(fn=>fn());return tree;},find(predicate){let found;walk(tree,node=>{if(!found&&predicate(node))found=node;});assertFound(found);return found;},all(predicate){const result=[];walk(tree,node=>{if(predicate(node))result.push(node);});return result;},close(){slots.forEach(item=>item?.cleanup?.());globalThis.document=oldDocument;globalThis.window=oldWindow;}};
  api.render();return api;
}
function assertFound(value){if(!value)throw Error('Component control not found');}
