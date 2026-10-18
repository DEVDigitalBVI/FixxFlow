import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

function fixture(){
 const previous={document:globalThis.document,Node:globalThis.Node,Element:globalThis.Element};
 class Target{};class LinkTarget extends Target{closest(){return {};}}
 globalThis.Node=Target;globalThis.Element=LinkTarget;
 const inside=new Target(),outside=new Target();const listeners=new Map();let focused=0,index=0,cleanup;
 const panel={open:true,contains:target=>target===inside};
 globalThis.document={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const refs=[{current:panel},{current:{focus(){focused++;}}}];
 const {NavigationDisclosure}=load('src/components/navigation/navigation-disclosure.tsx',{react:{...React,useRef:()=>refs[index++],useEffect:fn=>{cleanup=fn();}}});
 const tree=NavigationDisclosure({className:'employee-more-nav',summary:'Account',children:'Links'});
 return {panel,inside,outside,listeners,tree,focused:()=>focused,link:new LinkTarget(),close(){cleanup();Object.assign(globalThis,previous);}};
}

test('account disclosure dismisses outside pointer and focus without stealing destination focus',()=>{
 const f=fixture();try{
  f.listeners.get('pointerdown')({target:f.inside});assert.equal(f.panel.open,true);
  f.listeners.get('pointerdown')({target:f.outside});assert.equal(f.panel.open,false);assert.equal(f.focused(),0);
  f.panel.open=true;f.tree.props.onBlurCapture({currentTarget:f.panel,relatedTarget:f.inside});assert.equal(f.panel.open,true);
  f.tree.props.onBlurCapture({currentTarget:f.panel,relatedTarget:f.outside});assert.equal(f.panel.open,false);
 }finally{f.close();}assert.equal(f.listeners.size,0);
});

test('Escape restores summary focus and navigating closes even an active-route link',()=>{
 const f=fixture();try{
  let prevented=false,stopped=false;f.tree.props.onKeyDown({key:'Escape',currentTarget:f.panel,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(f.panel.open,false);assert.equal(f.focused(),1);assert.ok(prevented&&stopped);
  f.panel.open=true;f.tree.props.onClick({target:f.link,currentTarget:f.panel});assert.equal(f.panel.open,false);
 }finally{f.close();}
});

test('being on My chats does not automatically open the Account dropdown',()=>{
 const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',{
  'next/navigation':{usePathname:()=>'/app/chat'},'next/link':{default:props=>React.createElement('a',props)},
  '@/features/search/global-search':{GlobalSearch:()=>null},'@/features/theme/theme-control':{ThemeControl:()=>null},
  '@/features/notifications/notification-link':{NotificationLink:()=>null},
 });
 const html=renderToStaticMarkup(React.createElement(WorkspaceNav,{role:'end_user',organizationId:'org',userId:'viewer'}));
 assert.match(html,/<details class="employee-more-nav">/);assert.doesNotMatch(html,/<details[^>]*open=/);assert.match(html,/aria-current="page"[^>]*>.*?My chats/);
});
