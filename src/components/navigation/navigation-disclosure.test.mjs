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
 const refs=[{current:panel},{current:{focus(){focused++;}}},{current:false}];
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

test('Escape restores summary focus and links close after native navigation can run',async()=>{
 const f=fixture();try{
  let prevented=false,stopped=false;f.tree.props.onKeyDown({key:'Escape',currentTarget:f.panel,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(f.panel.open,false);assert.equal(f.focused(),1);assert.ok(prevented&&stopped);
  f.panel.open=true;f.tree.props.onClick({target:f.link,currentTarget:f.panel});assert.equal(f.panel.open,true);
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.panel.open,false);
 }finally{f.close();}
});

test('a pointer inside the menu can blur to no focus target without cancelling the link click',async()=>{
 const f=fixture();try{
  f.listeners.get('pointerdown')({target:f.inside});
  f.tree.props.onBlurCapture({currentTarget:f.panel,relatedTarget:null});
  assert.equal(f.panel.open,true);
  f.tree.props.onClick({target:f.link,currentTarget:f.panel});
  assert.equal(f.panel.open,true);
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.panel.open,false);
  f.panel.open=true;
  f.tree.props.onBlurCapture({currentTarget:f.panel,relatedTarget:null});assert.equal(f.panel.open,false);
 }finally{f.close();}
});

test('My chats is directly accessible in employee navigation and active for an existing conversation',()=>{
 const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',{
  'next/navigation':{usePathname:()=>'/app/chat/existing-conversation'},'next/link':{default:props=>React.createElement('a',props)},
  '@/features/search/global-search':{GlobalSearch:()=>null},'@/features/theme/theme-control':{ThemeControl:()=>null},
  '@/features/notifications/notification-link':{NotificationLink:()=>null},
 });
 const html=renderToStaticMarkup(React.createElement(WorkspaceNav,{role:'end_user',organizationId:'org',userId:'viewer'}));
 assert.match(html,/<details class="staff-more-nav">/);assert.doesNotMatch(html,/<details[^>]*open=/);assert.match(html,/aria-current="page"[^>]*>.*?My chats/);
 const primary=html.split('<details class="staff-more-nav">')[0];
 const account=html.split('<details class="staff-more-nav">')[1].split('</details>')[0];
  for (const [path,label] of [['profile','Profile'],['security','Security'],['support','Contact support']]) {
   assert.match(account,new RegExp(`href="/app/${path}"[^>]*aria-label="${label}"`));
  }
  assert.doesNotMatch(account,/aria-label="Account"[^>]*href=|href="\/app\/profile"[^>]*aria-label="Account"/);
 assert.match(primary,/<a[^>]*href="\/app\/chat"[^>]*aria-current="page"/);
 assert.doesNotMatch(account,/href="\/app\/chat"/);
 assert.equal((html.match(/href="\/app\/chat"/g)||[]).length,1);
});


test('employee sidebar shares account and resource patterns without staff destinations',()=>{
 for(const inventoryAccess of [false,true]){
  const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',{
   'next/navigation':{usePathname:()=>'/app/profile'},'next/link':{default:props=>React.createElement('a',props)},
   '@/features/search/global-search':{GlobalSearch:()=>null},'@/features/theme/theme-control':{ThemeControl:()=>null},
   '@/features/notifications/notification-link':{NotificationLink:props=>React.createElement('a',{href:'/app/notifications',className:props.className},'Notifications')},
  });
  const html=renderToStaticMarkup(React.createElement(WorkspaceNav,{role:'end_user',organizationId:'org',userId:'viewer',inventoryAccess}));
  const primary=html.split('<details class="staff-more-nav">')[0];
  assert.match(primary,/href="\/app\/notifications"/);
  for(const destination of ['chat','help','assets'])assert.ok(primary.includes('href="/app/'+destination+'"'));
  assert.equal(primary.includes('href="/app/inventory"'),inventoryAccess);
  for(const destination of ['reports','people','administration'])assert.ok(!html.includes('href="/app/'+destination+'"'));
  assert.doesNotMatch(html,/>Manage<|employee-more-nav/);
  assert.match(html,/<summary class="nav-link" aria-label="Account"/);
  assert.match(html,/href="\/app\/profile"[^>]*aria-current="page"/);
  assert.doesNotMatch(html,/<details[^>]*open=/);
 }
});

test('all navigation variants expose named groups without visible section headers', () => {
 for (const role of ['end_user', 'agent', 'administrator']) {
  for (const platform of [false, true]) {
   for (const workspaceAvailable of [false, true]) {
    const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
     'next/navigation': { usePathname: () => platform ? '/platform/analytics' : '/app/tickets' },
     'next/link': { default: props => React.createElement('a', props) },
     '@/features/search/global-search': { GlobalSearch: () => null },
     '@/features/theme/theme-control': { ThemeControl: () => null },
     '@/features/notifications/notification-link': { NotificationLink: props => React.createElement('a', { href: '/app/notifications', className: props.className }, 'Notifications') },
    });
    const html = renderToStaticMarkup(React.createElement(WorkspaceNav, { role, platform, workspaceAvailable, organizationId: 'org', userId: 'viewer' }));
    const groupNames = [...html.matchAll(/<ul class="nav-list nav-group" aria-label="([^"]+)">/g)].map(match => match[1]);
    assert.deepEqual(groupNames, platform
     ? ['Platform', ...(workspaceAvailable ? ['Workspace'] : [])]
     : [role === 'end_user' ? 'Support' : 'Work', 'Resources', ...(role === 'end_user' ? [] : ['Manage'])]);
    assert.doesNotMatch(html, /nav-group-label|>Support<|>Work<|>Resources<|>Manage</);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /aria-controls="workspace-navigation" aria-expanded="false"/);
    if (platform) assert.equal(html.includes('href="/app"'), workspaceAvailable);
    else assert.match(html, /<summary class="nav-link" aria-label="Account"/);
   }
  }
 }
});
