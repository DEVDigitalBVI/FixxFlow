/** Local interface regression fixture. Synthetic data; no credentials or production mutations. */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

import ts from 'typescript';

import { renderTicketQueue } from '../fixtures/ticket-queue.mjs';
import { renderCompactPreview } from './compact-preview.mjs';
import { load } from './load-module.mjs';
import { productStyles } from './styles.mjs';

const root = process.cwd(),
  modules = new Map(),
  ids = new Map();
const { themeScript } = load('src/features/theme/theme.ts');
const queueHtml = await renderTicketQueue({ filters: { view: 'all' } });
const mocks = {
  '@/features/platform/owner-link': `exports.OwnerConsoleLink=()=>null;`,
  '@/features/identity/viewer-avatar': `exports.ViewerAvatar=props=>require('react').createElement('span',{'aria-label':props.name},'JM');`,
  './actions': `exports.updateProfile=async()=>({error:'Synthetic save failure. Your entries are preserved.'});exports.updateUsagePreference=async()=>{};exports.saveTimezone=async()=>({error:'Synthetic save failure.'});exports.bulkUpdateTickets=async()=>({error:'Synthetic save failure.'});`,
  '@/app/app/tickets/view-actions': `exports.saveQueueView=async()=>({error:'Synthetic preview only. Views are not saved.'});exports.deleteQueueView=async()=>({error:'Synthetic preview only.'});`,
  '@/app/app/help/actions': `exports.saveArticle=async()=>({error:'Synthetic article save failure. Your draft is preserved.'});`,
  '@/app/app/notifications/actions': `exports.markNotificationsRead=async(_,data)=>{window.fixtureReadCommand=Object.fromEntries(data);return {error:'Synthetic failure. Try again.'};};`,
  '@/features/tickets/ticket-detail': `exports.TicketDetail=()=>null;`,
  '@/features/tickets/data': `exports.loadTicketQueue=async(_,filters)=>({view:'all',sort:'updated',search:filters.q||'',page:1,error:null,profiles:[],teams:[],knowledgeCount:0,tag:null,tagOptions:[],savedViews:[],savedViewsError:false,rows:filters.q?[ ]:[{id:'request-fixture',tags:[],title:'Pilot Wi-Fi request',ticket_number:42,status:'open',priority:'normal',request_kind:'ticket',updated_at:'2026-10-19T12:00:00Z',created_at:'2026-10-19T12:00:00Z',requester_id:'fixture',assigned_technician_id:null,team_id:null,due_at:null}]});`,
  'server-only': `module.exports={};`,
  '@/app/app/inventory/actions': `exports.inventoryMutation=async()=>({error:'Synthetic preview only.'});`,
  '@/app/app/people/actions': `exports.updateMemberDetails=async()=>({error:'Synthetic preview only.'});`,
  '@/app/app/assets/actions': `exports.saveAsset=async()=>({error:'Synthetic asset save failure. Your draft is preserved.'});exports.changeAssetLink=async()=>({error:'Synthetic preview only.'});`,
  '@/features/product-analytics/usage-event': `exports.UsageEvent=()=>null;`,
  // Async server component; the client-only preview cannot render it.
  '@/features/portal/service-announcements': `exports.ServiceAnnouncements=()=>null;`,
  'node:crypto': `exports.randomUUID=()=>crypto.randomUUID();`,
  '@/lib/auth/viewer': `exports.requireViewer=async()=>({id:'fixture',organizationId:'fixture',role:(new URLSearchParams(location.search).get('role')||sessionStorage.getItem('fixture-role')||'').startsWith('employee')?'end_user':'administrator',displayName:'Jordan Morgan',organizationName:'Example workspace',timeZone:'America/Tortola'});`,
  '@/lib/supabase/server': `exports.createClient=async()=>{const rows={profiles:[{display_name:'Jordan Morgan',email:'jordan@example.invalid',phone:'',job_title:'',department_id:null,location_id:null}],notifications:[{id:'notification-fixture',kind:'user_replied',title:'IT replied to your request',ticket_id:'request-fixture',conversation_id:null,created_at:'2026-10-19T12:00:00Z',read_at:null}],knowledge_articles:[{id:'article-fixture',title:'Connect to Wi-Fi',summary:'Reconnect your device to the wireless network.',category:'Network',status:'published',updated_at:'2026-10-19T12:00:00Z'}],assets:[{id:'asset-fixture',tag:'LT-0042',name:'Work laptop',kind:'computer',status:'assigned',serial_number:'PILOT-SN-42',model:'Example laptop',assigned_user_id:'fixture',location_id:null}]};const source=table=>{let single=false;const query=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:single?(rows[table]||[])[0]:rows[table]||[],count:(rows[table]||[]).length,error:null}).then(resolve):()=>{if(key==='single'||key==='maybeSingle')single=true;return query;}});return query;};return {from:source,rpc:name=>source(name==='search_assets'?'assets':'knowledge_articles')};};`,
  '../actions': `exports.createTicket=async data=>{window.fixtureSubmitted=Object.fromEntries(data);if(!window.fixtureTicketRetried){window.fixtureTicketRetried=true;return {error:'Synthetic connection failure. Your request is preserved; try again.'};}return {redirectTo:'/app/tickets/fixture-created'};};`,
  '@/lib/supabase/client': `exports.createClient=()=>({realtime:{setAuth:async()=>{}},channel:()=>({on(){return this;},subscribe(fn){fn('SUBSCRIBED');return this;},track(){},send:async()=>({}),presenceState:()=>({})}),removeChannel(){},rpc:async(name,args)=>({data:[{id:args.message,author_id:'fixture',kind:'message',body:args.new_body,created_at:'2026-10-17T12:00:00Z',revision:args.expected_revision+1,edited_at:new Date().toISOString()}],error:null})});`,
  '@/app/app/chat/actions': `exports.startChat=async()=>({error:'Synthetic preview: no conversation was sent.'});`,
  'next/image': `exports.default=({fill,sizes,priority,unoptimized,...props})=>require('react').createElement('img',props);`,
  'next/navigation': `const React=require('react'); const subscribe=fn=>{window.addEventListener('popstate',fn);window.addEventListener('fixture-route',fn);return()=>{window.removeEventListener('popstate',fn);window.removeEventListener('fixture-route',fn);}};const notify=()=>window.dispatchEvent(new Event('fixture-route'));exports.usePathname=()=>React.useSyncExternalStore(subscribe,()=>window.location.pathname);exports.useSearchParams=()=>new URLSearchParams(React.useSyncExternalStore(subscribe,()=>window.location.search));exports.notFound=()=>{throw Error('notFound');};exports.useRouter=()=>({push:url=>{window.history.pushState({},'',url);notify();},replace:url=>{window.history.replaceState({},'',url);notify();},back:()=>window.history.back(),refresh:notify});`,
  'next/link': `exports.default=({children,scroll,prefetch,onNavigate,...props})=>require('react').createElement('a',props,children);`,
  '@/features/notifications/notification-link': `exports.NotificationLink=props=>require('react').createElement('a',{href:'/app/notifications',className:props.className,'aria-label':'Notifications',title:'Notifications'},require('react').createElement('svg',{viewBox:'0 0 24 24','aria-hidden':true},require('react').createElement('path',{d:'M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3Zm4 12h4'})),require('react').createElement('span',null,'Notifications'));`,
  '@/app/app/tickets/actions': `exports.updateTicket=async()=>({success:'Changes saved.',revision:2});`,
};
function add(filename, provided) {
  if (ids.has(filename)) return ids.get(filename);
  const id = ids.size;
  ids.set(filename, id);
  modules.set(id, '');
  const require = createRequire(path.resolve(root, 'package.json'));
  let code = provided ?? fs.readFileSync(filename, 'utf8');
  if (/\.tsx?$/.test(filename))
    code = ts.transpileModule(code, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
  code = code.replace(/require\(['"]([^'"]+)['"]\)/g, (_, name) => {
    let dependency;
    if (mocks[name]) dependency = add(`mock:${name}`, mocks[name]);
    else {
      const base = name.startsWith('@/')
        ? path.join(root, 'src', name.slice(2))
        : name.startsWith('.')
          ? path.resolve(path.dirname(filename), name)
          : null;
      const resolved = base
        ? [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(
            (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
          )
        : require.resolve(name);
      if (!resolved) throw Error(`Unresolved ${name} in ${filename}`);
      dependency = add(resolved);
    }
    return `require(${dependency})`;
  });
  modules.set(id, code);
  return id;
}
const entry = add(
  path.join(root, 'tests/fixtures/interface-audit-entry.tsx'),
  `
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {useSearchParams} from 'next/navigation';
import {WorkspaceNav} from '@/components/navigation/workspace-nav';
import {WorkspaceShell} from '@/components/navigation/workspace-shell';
import {Avatar} from '@/components/ui/avatar';
import {TicketQueueContext} from '@/features/tickets/queue-context';
import {MessageComposer} from '@/features/tickets/message-composer';
import {TicketDetailsForm} from '@/features/tickets/ticket-details-form';
import {OrganizationCreateForm} from '@/features/administration/organization-create-form';
import {SignupProgress} from '@/components/ui/signup-progress';
import {BrandLogo} from '@/components/brand/brand-logo';
import {AdministrationHub} from '@/features/administration/administration-hub';
import {EmployeeHome} from '@/features/portal/employee-home';
import {PageHeader} from '@/components/ui/page-header';
import {LiveSearchForm} from '@/components/ui/live-search-form';
import {ChatRoom} from '@/features/chat/chat-room';
import {ChatCenter} from '@/features/chat/chat-center';
import {ChatInbox} from '@/features/chat/chat-inbox';
import {StartChatForm,ChatIntakeGuide} from '@/features/chat/start-chat-form';
import AuthLayout from '@/app/(auth)/layout';
import NewTicketPage from '@/app/app/tickets/new/page';
import HelpPage from '@/app/app/help/page';
import AssetsPage from '@/app/app/assets/page';
import ProfilePage from '@/app/app/profile/page';
import NotificationsPage from '@/app/app/notifications/page';
import TicketsPage from '@/app/app/tickets/page';
import PeoplePage from '@/app/app/people/page';
import {ThemeController} from '@/features/theme/theme-control';
import {AssetForm} from '@/features/assets/asset-form';
import {ArticleEditor} from '@/features/knowledge/article-editor';
import {CustomReportBuilder} from '@/features/reporting/custom-builder';
import {defaultReportDefinition} from '@/features/reporting/custom-model';
const ticket={id:'ticket-0',revision:1,status:'open',priority:'normal',assigned_technician_id:null,team_id:null,category_id:null,subcategory_id:null,location_id:null,due_at:null};
function Preview(){const params=useSearchParams();if(params.get('role'))sessionStorage.setItem('fixture-role',params.get('role'));const selected=params.get('ticket')??undefined;const employee=['employee','employee-no-inventory'].includes(params.get('role')??sessionStorage.getItem('fixture-role')??'');const platform=params.get('role')==='platform';const [failed,setFailed]=useState(false);const [featurePage,setFeaturePage]=useState(null);const feature=params.get('ticket')?null:params.get('surface')||({ '/app/tickets/new':'new-ticket', '/app/help':'help', '/app/assets':'assets','/app/profile':'profile','/app/notifications':'notifications','/app/tickets':'tickets','/app/people':'people' }[location.pathname]);useEffect(()=>{const Page=feature==='new-ticket'?NewTicketPage:feature==='help'?HelpPage:feature==='assets'?AssetsPage:feature==='profile'?ProfilePage:feature==='notifications'?NotificationsPage:feature==='tickets'?TicketsPage:feature==='people'?PeoplePage:null;if(Page)void Page({searchParams:Promise.resolve(Object.fromEntries(params))}).then(setFeaturePage);else setFeaturePage(null);},[feature,params.toString()]);const panel=<div className="page"><header className="page-header ticket-heading"><h2>VPN disconnects during video calls</h2></header><div className="ticket-layout"><div className="ticket-main"><section className="settings-card"><h2>Conversation</h2><p>Synthetic conversation fixture.</p><MessageComposer ticketId="ticket-0" action={async()=>({error:'Simulated failure. Your draft is preserved.'})}/></section></div><aside className="ticket-sidebar"><TicketDetailsForm ticket={ticket} timeZone="America/Tortola"/></aside></div></div>;
if(params.get('surface')==='auth')return <AuthLayout><section className="auth-card"><h1>Welcome back</h1><p className="auth-intro">Sign in to continue to your support workspace.</p><div className="stack"><label className="field"><span>Email address</span><input className="input" type="email" placeholder="you@example.com"/></label><label className="field"><span>Password</span><input className="input" type="password"/></label><button className="button button-primary" type="button">Sign in</button></div></section></AuthLayout>;
const previewChats=[{id:'fixture-chat',topic:'VPN connection',requester_id:'fixture',assigned_technician_id:'technician',status:'open',ticket_id:null,updated_at:'2026-10-17T12:01:00Z',preview:{body:'Hi Jordan, I can help. Are you working from home today?',author_id:'technician'},unread:1},{id:'fixture-closed',topic:'Laptop setup',requester_id:'fixture',assigned_technician_id:'technician',status:'closed',ticket_id:null,updated_at:'2026-10-16T12:00:00Z',preview:{body:'Thanks, that worked!',author_id:'fixture'}}];
const chatSurface=params.get('surface')==='chat-fixes'?<ChatCenter personal={employee} inbox={<ChatInbox chats={previewChats} names={new Map([['fixture','Jordan Morgan'],['technician','Casey Robinson']])} failed={false} view="open" organizationId="fixture" viewerId="fixture" personal={employee} selectedId="fixture-chat"/>}><section className="chat-active"><header className="chat-active-header"><a className="button button-quiet chat-back" href="/app/chat">← My chats</a><Avatar name={employee?'Casey Robinson':'Jordan Morgan'}/><div className="chat-active-identity"><h2>VPN connection</h2><p>{employee?'Chatting with Casey Robinson':'Jordan Morgan'} · Open</p></div></header><div className="chat-active-body"><ChatRoom conversationId="fixture-chat" organizationId="fixture" viewerId="fixture" isWorker={!employee} open names={{technician:'Casey Robinson'}} supportName="Casey Robinson" assigned participantId="technician" initialMessages={[{id:'fixture-message',author_id:'fixture',kind:'message',body:'I cant connect to the VPN.',created_at:'2026-10-17T12:00:00Z',revision:1,edited_at:null},{id:'fixture-reply',author_id:'technician',kind:'message',body:'Hi Jordan, I can help. Are you working from home today?',created_at:'2026-10-17T12:01:00Z',revision:1,edited_at:null}]} attachments={[{id:'fixture-file',file_name:'Connection screenshot.png',size_bytes:2048,created_at:'2026-10-17T12:00:30Z',storage_path:'fixture',content_type:'image/png',uploaded_by:'fixture',url:'/brand/fixxflow/icon/fixxflow-icon-primary.png'}]}/></div></section></ChatCenter>:params.get('surface')==='chat-intake'?<div className="portal-page chat-intake-page"><PageHeader title="Start a chat" eyebrow="Your IT support" description="Tell us what’s happening. We’ll take it from here." back={{href:'/app/chat',label:'Back to chats'}}/><div className="chat-intake-layout"><StartChatForm submissionKey="90000000-0000-4000-8000-000000000001"/><ChatIntakeGuide/></div></div>:null;
const requestsSurface=params.get('surface')==='requests-search'?<div className="portal-page"><header className="portal-page-heading"><div><h1>My requests</h1><p>See updates, read replies, and continue a conversation with IT.</p></div></header><LiveSearchForm action="/app/tickets" className="portal-search" label="Search requests" resultSummary="No requests found."><label htmlFor="ticket-search">Search requests</label><div><input id="ticket-search" className="input" name="q" type="search" aria-describedby="ticket-search-hint" placeholder="Words or #ticket number"/><button className="button button-secondary">Search</button></div></LiveSearchForm><p id="ticket-search-hint" className="muted">Matches any part, ignoring case. Use # for an exact ticket number.</p></div>:null;
const toolsSurface=params.get('surface')==='asset-editor'?<div className="page"><PageHeader title="Add asset"/><AssetForm/></div>:params.get('surface')==='article-editor'?<div className="page"><PageHeader title="New article"/><ArticleEditor isNew organizationId="fixture" assets={[]} related={[{id:'related-fixture',title:'Related help guide'}]} article={{id:'article-fixture',title:'Pilot guide',summary:'',category:'Network',content:[{type:'paragraph',text:'Pilot content'}],status:'draft',related_article_ids:['related-fixture'],revision:1}}/></div>:params.get('surface')==='report-builder'?<div className="page"><PageHeader title="Custom report"/><CustomReportBuilder definition={defaultReportDefinition('2026-10-19')} references={{categories:[],subcategories:[],teams:[],technicians:[],departments:[],locations:[]}}/></div>:null;
const content=<>{toolsSurface??featurePage??chatSurface??requestsSurface??(params.get('surface')==='administration'?<AdministrationHub organizationName="Example workspace"/>:employee?<EmployeeHome firstName="Jordan" greeting="Good afternoon" organizationName="Example workspace" recent={[]}/>:<TicketQueueContext returnTo="/app/tickets?view=all" selected={selected} panel={selected?panel:null}><div dangerouslySetInnerHTML={{__html:window.fixtureQueue}}/></TicketQueueContext>)} {!employee&&!chatSurface&&!featurePage&&!toolsSurface&&<section className="page stack"><SignupProgress current={2}/><h2>Create a location</h2><OrganizationCreateForm kind="location" timezone="America/Tortola" action={async()=>{if(!failed){setFailed(true);return {error:'Review the location details.',fieldErrors:{name:'That name already exists. Choose another name.'}};}return {success:'Location added in fixture.'};}}/></section>}</>;return <WorkspaceShell audience={employee?"employee":"staff"} brand={<BrandLogo variant="navigation" className="sidebar-logo"/>} navigation={<WorkspaceNav role={employee?'end_user':params.get('role')==='technician'?'technician':'administrator'} organizationId="fixture" userId="fixture" inventoryAccess={params.get('role')!=='employee-no-inventory'} platform={platform}/>} account={<div className="sidebar-account"><Avatar name="Jordan Morgan"/><div className="account-copy"><strong>Jordan Morgan</strong><span>{employee?'Employee':'Administrator'}</span></div><button className="sign-out-button" type="button" aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H5v16h4m7-4 4-4-4-4m4 4H9"/></svg></button></div>}>{content}</WorkspaceShell>}
createRoot(document.getElementById('root')!).render(<><Preview/><ThemeController/></>);`,
);
const bundle = `var process={env:{NODE_ENV:'development'}};var global=globalThis;(()=>{const modules={${[...modules].map(([id, code]) => `${id}:(require,module,exports)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${entry});})();`;

let searchFailed = false;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/bundle.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle);
    return;
  }
  if (url.pathname === '/style.css') {
    response.setHeader('Content-Type', 'text/css');
    // Shared and feature module styles, read per request so edits show on reload.
    response.end(productStyles());
    return;
  }
  if (url.pathname.startsWith('/brand/')) {
    const file = path.join(root, 'public', url.pathname);
    response.setHeader(
      'Content-Type',
      url.pathname.endsWith('.woff2')
        ? 'font/woff2'
        : url.pathname.endsWith('.ttf')
          ? 'font/ttf'
          : 'image/png',
    );
    response.end(fs.readFileSync(file));
    return;
  }
  if (url.pathname === '/app/lookups') {
    const resource = url.searchParams.get('resource');
    const rows =
      resource === 'people' || resource === 'technicians'
        ? [{ id: 'fixture', label: 'Jordan Morgan', active: true, parent_id: null }]
        : resource === 'teams'
          ? [{ id: 'team', label: 'IT support', active: true, parent_id: null }]
          : resource === 'categories'
            ? [{ id: 'category', label: 'Network', active: true, parent_id: null }]
            : resource === 'locations'
              ? [{ id: 'location', label: 'Main office', active: true, parent_id: null }]
              : [];
    const q = (url.searchParams.get('q') || '').toLowerCase();
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        rows: rows.filter((row) => row.label.toLowerCase().includes(q)),
        selected: rows.find((row) => row.id === url.searchParams.get('selected')) || null,
        next: null,
      }),
    );
    return;
  }
  if (url.pathname === '/app/search') {
    response.setHeader('Content-Type', 'application/json');
    if (url.searchParams.get('q') === 'fail' && !searchFailed) {
      searchFailed = true;
      response.statusCode = 503;
      response.end('{}');
    } else
      response.end(
        JSON.stringify({
          results: /vpn/i.test(url.searchParams.get('q') ?? '')
            ? [
                {
                  id: 'ticket-0',
                  label: 'VPN disconnects during video calls',
                  detail: '#1842',
                  href: '/app/tickets?view=all&ticket=ticket-0',
                  group: 'Tickets',
                },
              ]
            : [],
        }),
      );
    return;
  }
  if (url.pathname === '/compact') {
    response.setHeader('Content-Type', 'text/html');
    response.end(renderCompactPreview(url.searchParams));
    return;
  }
  searchFailed = false;
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><html lang="en" data-theme="' +
      (url.searchParams.get('theme') === 'dark' ? 'dark' : 'light') +
      '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FixxFlow interface fixture</title><script>' +
      themeScript +
      '</script><style>@font-face{font-family:Outfit;src:url(/brand/fixxflow/fonts/Outfit-Variable.ttf) format(truetype);font-weight:100 900}@font-face{font-family:RethinkSans;src:url(/brand/fixxflow/fonts/RethinkSans-Variable.ttf) format(truetype);font-weight:400 800}:root{--font-outfit:Outfit;--font-rethink-sans:RethinkSans}</style><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script>window.fixtureQueue=' +
      JSON.stringify(queueHtml).replaceAll('<', '\\u003c') +
      ';</script><script src="/bundle.js"></script></body></html>',
  );
});
const port = Number(process.argv[2]) || 4183;
server.listen(port, '127.0.0.1', () => console.log(`Interface preview: http://127.0.0.1:${port}`));
