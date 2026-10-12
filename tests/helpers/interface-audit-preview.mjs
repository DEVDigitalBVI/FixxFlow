/** Local interface regression fixture. Synthetic data; no credentials or production mutations. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderTicketQueue } from '../fixtures/ticket-queue.mjs';
const root=process.cwd(), modules=new Map(), ids=new Map();
const queueHtml=await renderTicketQueue({filters:{view:'all'}});
const mocks={
 'next/image': `exports.default=({fill,sizes,priority,unoptimized,...props})=>require('react').createElement('img',props);`,
 'next/navigation': `const React=require('react'); const subscribe=fn=>{window.addEventListener('popstate',fn);window.addEventListener('fixture-route',fn);return()=>{window.removeEventListener('popstate',fn);window.removeEventListener('fixture-route',fn);}};const notify=()=>window.dispatchEvent(new Event('fixture-route'));exports.usePathname=()=>React.useSyncExternalStore(subscribe,()=>window.location.pathname);exports.useSearchParams=()=>new URLSearchParams(React.useSyncExternalStore(subscribe,()=>window.location.search));exports.useRouter=()=>({push:url=>{window.history.pushState({},'',url);notify();},replace:url=>{window.history.replaceState({},'',url);notify();},back:()=>window.history.back(),refresh:notify});`,
 'next/link': `exports.default=({children,scroll,prefetch,onNavigate,...props})=>require('react').createElement('a',props,children);`,
 '@/features/notifications/notification-link': `exports.NotificationLink=props=>require('react').createElement('a',{href:'/app/notifications',className:props.className},'Notifications');`,
 '@/app/app/tickets/actions': `exports.updateTicket=async()=>({success:'Changes saved.',revision:2});`,
};
function add(filename,provided){
 if(ids.has(filename))return ids.get(filename);
 const id=ids.size;ids.set(filename,id);modules.set(id,'');
 const require=createRequire(path.resolve(root,'package.json'));
 let code=provided??fs.readFileSync(filename,'utf8');
 if(/\.tsx?$/.test(filename))code=ts.transpileModule(code,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>{
   let dependency;
   if(mocks[name])dependency=add(`mock:${name}`,mocks[name]);
   else {const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
     const resolved=base?[base,`${base}.ts`,`${base}.tsx`,`${base}.js`].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile()):require.resolve(name);
     if(!resolved)throw Error(`Unresolved ${name} in ${filename}`);dependency=add(resolved);
   }
   return `require(${dependency})`;
 });
 modules.set(id,code);return id;
}
const entry=add(path.join(root,'tests/fixtures/interface-audit-entry.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useSearchParams} from 'next/navigation';
import {WorkspaceNav} from '@/components/navigation/workspace-nav';
import {TicketQueueContext} from '@/features/tickets/queue-context';
import {MessageComposer} from '@/features/tickets/message-composer';
import {TicketDetailsForm} from '@/features/tickets/ticket-details-form';
import {OrganizationCreateForm} from '@/features/administration/organization-create-form';
import {SignupProgress} from '@/components/ui/signup-progress';
import {BrandLogo} from '@/components/brand/brand-logo';
const ticket={id:'ticket-0',revision:1,status:'open',priority:'normal',assigned_technician_id:null,team_id:null,category_id:null,subcategory_id:null,location_id:null,due_at:null};
function Preview(){const params=useSearchParams(),selected=params.get('ticket')??undefined;const employee=['employee','employee-no-inventory'].includes(params.get('role')??'');const platform=params.get('role')==='platform';const [failed,setFailed]=useState(false);const panel=<div className="page"><header className="page-header ticket-heading"><h2>VPN disconnects during video calls</h2></header><div className="ticket-layout"><div className="ticket-main"><section className="settings-card"><h2>Conversation</h2><p>Synthetic conversation fixture.</p><MessageComposer ticketId="ticket-0" action={async()=>({error:'Simulated failure. Your draft is preserved.'})}/></section></div><aside className="ticket-sidebar"><TicketDetailsForm ticket={ticket} timeZone="America/Tortola"/></aside></div></div>;
return <div className={employee?'portal-shell':'app-shell'}>{employee?<header className="portal-header"><BrandLogo variant="full" className="portal-logo"/><WorkspaceNav role="end_user" organizationId="fixture" userId="fixture" inventoryAccess={params.get('role')!=='employee-no-inventory'}/></header>:<aside className="sidebar"><div className="sidebar-brand"><BrandLogo variant="full" className="sidebar-logo-full"/></div><WorkspaceNav role={params.get('role')==='technician'?'technician':'administrator'} organizationId="fixture" userId="fixture" inventoryAccess platform={platform}/></aside>}<main id="main-content" className={employee?'portal-main':'workspace'}>{employee?<div className="portal-page"><h1>How can we help?</h1><p>Isolated employee navigation fixture.</p></div>:<TicketQueueContext returnTo="/app/tickets?view=all" selected={selected} panel={selected?panel:null}><div dangerouslySetInnerHTML={{__html:window.fixtureQueue}}/></TicketQueueContext>}<section className="page stack"><SignupProgress current={2}/><h2>Create a location</h2><OrganizationCreateForm kind="location" timezone="America/Tortola" action={async()=>{if(!failed){setFailed(true);return {error:'Review the location details.',fieldErrors:{name:'That name already exists. Choose another name.'}};}return {success:'Location added in fixture.'};}}/></section></main></div>}
createRoot(document.getElementById('root')!).render(<Preview/>);`);
const bundle=`var process={env:{NODE_ENV:'development'}};var global=globalThis;(()=>{const modules={${[...modules].map(([id,code])=>`${id}:(require,module,exports)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${entry});})();`;

let searchFailed = false;
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle);return;}
 if(url.pathname==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync('src/app/globals.css'));return;}
 if(url.pathname.startsWith('/brand/')){const file=path.join(root,'public',url.pathname);response.setHeader('Content-Type','image/png');response.end(fs.readFileSync(file));return;}
 if(url.pathname==='/app/lookups'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({rows:[],selected:null,next:null}));return;}
 if(url.pathname==='/app/search'){response.setHeader('Content-Type','application/json');if(url.searchParams.get('q')==='fail'&&!searchFailed){searchFailed=true;response.statusCode=503;response.end('{}');}else response.end(JSON.stringify({results:/vpn/i.test(url.searchParams.get('q')??'')?[{id:'ticket-0',label:'VPN disconnects during video calls',detail:'#1842',href:'/app/tickets?view=all&ticket=ticket-0',group:'Tickets'}]:[]}));return;}
 if(url.pathname==='/compact'){const width=Number(url.searchParams.get('width'))||390;const role=url.searchParams.get('role')||'';const theme=url.searchParams.get('theme')||'light';response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en"><head><title>Interface audit viewport</title></head><body><h1>'+width+'px '+role+' '+theme+' fixture</h1><iframe title="Audit viewport" src="/app/tickets?view=all&role='+role+'&theme='+theme+'" style="width:'+width+'px;height:850px;border:1px solid gray"></iframe></body></html>');return;}
 response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en" data-theme="'+(url.searchParams.get('theme')==='dark'?'dark':'light')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FixxFlow interface fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script>window.fixtureQueue='+JSON.stringify(queueHtml).replaceAll('<','\\u003c')+';</script><script src="/bundle.js"></script></body></html>');
});
server.listen(4183,'127.0.0.1',()=>console.log('Interface preview: http://127.0.0.1:4183'));
