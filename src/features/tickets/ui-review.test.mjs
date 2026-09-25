import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(file,mocks={}) {const compiledModule={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(n=>mocks[n]??require(n),compiledModule,compiledModule.exports);return compiledModule.exports;}
const navMocks={'next/navigation':{usePathname:()=>'/app/tickets'},'next/link':{default:props=>React.createElement('a',props)},'@/features/notifications/notification-link':{NotificationLink:()=>React.createElement('a',{href:'/app/notifications'},'Notifications')}};
test('employee navigation keeps employee labels and excludes staff destinations',()=>{
 const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',navMocks);
 const html=renderToStaticMarkup(React.createElement(WorkspaceNav,{role:'end_user',organizationId:'org',userId:'user'}));
 for(const text of ['Home','My tickets','My chats','Help articles','Account','Security'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/href="\/app\/(administration|people)"/);
 assert.match(html,/aria-label="Employee navigation"/);
});
test('mobile menu contains a close control, locks background, traps focus and restores state',()=>{
 let effect,cleanup,closed=false,buttonFocused=false,firstFocused=false,lastFocused=false;
 const first={focus:()=>{firstFocused=true;}},last={focus:()=>{lastFocused=true;}};
 const main={inert:false},doc={body:{style:{overflow:'auto'}},getElementById:()=>main,activeElement:last};
 const handlers={};const media={matches:false,addEventListener:(key,fn)=>handlers.resize=fn,removeEventListener:()=>{}};
 const win={requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame:()=>{},matchMedia:()=>media,addEventListener:(key,fn)=>handlers[key]=fn,removeEventListener:()=>{}};
 let refs=0;const react={...React,useState:()=>[true,v=>{closed=v===false;}],useRef:()=>({current:refs++===0?{focus:()=>buttonFocused=true}:{querySelectorAll:()=>[first,last],contains:node=>node===first||node===last}}),useEffect:fn=>{effect=fn;}};
 globalThis.document=doc;globalThis.window=win;
 try {
  const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',{...navMocks,react});
  const html=renderToStaticMarkup(WorkspaceNav({role:'administrator',organizationId:'org',userId:'user'}));
  assert.match(html,/role="dialog" aria-modal="true"/);assert.match(html,/nav-close/);
  cleanup=effect();assert.equal(main.inert,true);assert.equal(doc.body.style.overflow,'hidden');assert.equal(firstFocused,true);
  let prevented=false;handlers.keydown({key:'Tab',preventDefault:()=>prevented=true});assert.equal(prevented,true);
  doc.activeElement=first;handlers.keydown({key:'Tab',shiftKey:true,preventDefault:()=>{}});assert.equal(lastFocused,true);
  doc.activeElement={};prevented=false;handlers.keydown({key:'Tab',preventDefault:()=>prevented=true});assert.equal(prevented,true);
  handlers.keydown({key:'Escape'});assert.equal(closed,true);assert.equal(buttonFocused,true);
  cleanup();assert.equal(main.inert,false);assert.equal(doc.body.style.overflow,'auto');
 } finally {delete globalThis.document;delete globalThis.window;}
});
test('bulk actions appear only for selected rows and clear selection restores row focus',()=>{
 let count=0,effect,handler,focused=false;
 const row={checked:true,indeterminate:false,focus:()=>focused=true};
 const form={querySelectorAll:selector=>selector.includes(':checked')?(row.checked?[row]:[]):[row],querySelector:()=>row,addEventListener:(_,fn)=>handler=fn,removeEventListener:()=>{}};
 const {BulkActions}=load('src/features/tickets/bulk-actions.tsx',{react:{...React,useState:()=>[count,n=>count=n],useEffect:fn=>effect=fn}});
 globalThis.document={getElementById:()=>form};
 try{let tree=BulkActions({formId:'tickets',children:'Controls'});assert.equal(tree.props.hidden,true);effect();tree=BulkActions({formId:'tickets',children:'Controls'});assert.equal(tree.props.hidden,false);assert.match(renderToStaticMarkup(tree),/1 ticket selected/);tree.props.children[0].props.children[1].props.onClick();assert.equal(row.checked,false);assert.equal(count,0);assert.equal(focused,true);handler();assert.equal(count,0);}finally{delete globalThis.document;}
});
test('pending submit buttons prevent duplicate submission and announce progress',()=>{
 const {SubmitButton}=load('src/components/ui/submit-button.tsx',{'react-dom':{useFormStatus:()=>({pending:true})}});
 const html=renderToStaticMarkup(SubmitButton({children:'Save profile',pendingLabel:'Saving profile…'}));
 assert.match(html,/disabled=""/);assert.match(html,/aria-busy="true"/);assert.match(html,/Saving profile/);
});
test('interactive blue and muted text meet normal-text contrast on white',()=>{
 const css=fs.readFileSync('src/app/globals.css','utf8');
 const luminance=hex=>{const rgb=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 for(const name of ['accent','text-muted','text-subtle']){const hex=css.match(new RegExp(`--color-${name}: (#\\w+);`))[1];assert.ok(1.05/(luminance(hex)+.05)>=4.5,`${name} contrast`);}
});

test('select all synchronizes row selection and notifies the bulk toolbar',()=>{
 const rows=[{checked:false},{checked:false}];let notified=false;
 const {BulkSelectAll}=load('src/features/tickets/bulk-select-all.tsx',{react:{...React,useRef:()=>({current:null}),useEffect:()=>{}}});
 globalThis.document={querySelectorAll:()=>rows,getElementById:()=>({dispatchEvent:event=>{notified=event.type==='change';}})};
 try {BulkSelectAll({formId:'tickets'}).props.onChange({currentTarget:{checked:true}});assert.ok(rows.every(row=>row.checked));assert.equal(notified,true);}finally{delete globalThis.document;}
});

test('every role can find chat creation and gets a labeled form with realistic response expectations',async()=>{
 const builder=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:[],error:null}).then(resolve):()=>builder});
 for(const role of ['end_user','technician','administrator']) {
  const page=load('src/app/app/chat/page.tsx',{
   'next/link':{default:props=>React.createElement('a',props)},
   '@/lib/auth/viewer':{requireViewer:async()=>({role,id:'user',organizationId:'org'})},
   '@/lib/supabase/server':{createClient:async()=>({from:()=>builder})},
   '@/features/chat/live-queue':{LiveChatQueue:()=>null},
   '@/features/tickets/presentation':{formatTicketDate:v=>v},
   '@/components/ui/submit-button':{SubmitButton:props=>{const buttonProps={...props};delete buttonProps.pendingLabel;return React.createElement('button',buttonProps);}},
   './actions':{startChat:async()=>{}},
  }).default;
  const list=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}));
  assert.match(list,/href="\/app\/chat\?start=1"/);
  for(const params of [{start:'1'},{error:'Please try again.'}]) {
   const form=renderToStaticMarkup(await page({searchParams:Promise.resolve(params)}));
   assert.match(form,/<h1>Start a chat<\/h1>/);
   assert.match(form,/<label for="chat-topic">/);assert.match(form,/<label for="chat-first-message">/);
   assert.match(form,/technician may not be available immediately/);
   assert.match(form,/href="\/app\/chat"/);
   if(params.error)assert.match(form,/role="alert"/);
  }
 }
});


test('desktop navigation does not move focus to the hidden mobile menu button',()=>{
 let focused=false;
 const {WorkspaceNav}=load('src/components/navigation/workspace-nav.tsx',{
  ...navMocks,
  react:{...React,useState:()=>[false,()=>{}],useRef:()=>({current:{focus:()=>focused=true}}),useEffect:()=>{}},
 });
 const tree=WorkspaceNav({role:'technician',organizationId:'org',userId:'user'});
 const panel=tree.props.children[2];
 const firstLink=panel.props.children[1].props.children.props.children[0][0].props.children;
 firstLink.props.onClick();
 assert.equal(focused,false);
});

test('input boundaries and focus contrast meet 3:1 on adjacent light surfaces',()=>{
 const css=fs.readFileSync('src/app/globals.css','utf8');
 const luminance=hex=>{const rgb=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 const token=name=>css.match(new RegExp(`--color-${name}: (#\\w+);`))[1];
 for(const surface of ['surface','canvas','surface-subtle']){
  for(const foreground of ['control-border','focus']){
   assert.ok((luminance(token(surface))+.05)/(luminance(token(foreground))+.05)>=3,`${foreground} on ${surface}`);
  }
 }
});
