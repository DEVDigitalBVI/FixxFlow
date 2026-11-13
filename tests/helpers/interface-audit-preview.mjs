/** Local interface regression fixture. Synthetic data; no credentials or production mutations. */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

import ts from 'typescript';

import { supportPreviewMocks } from '../fixtures/support-viewer.mjs';
import { renderTicketQueue } from '../fixtures/ticket-queue.mjs';
import { renderCompactPreview } from './compact-preview.mjs';
import { load } from './load-module.mjs';
import { compiledProductStyles } from './styles.mjs';

const root = process.cwd(),
  modules = new Map(),
  ids = new Map();
const { themeScript } = load('src/features/theme/theme.ts');
const queueHtml = await renderTicketQueue({ filters: { view: 'all' } });
const mocks = {
  '@/app/app/organization/actions': `exports.editOrganizationItem=async()=>({error:'Synthetic save failure. Your entries are preserved.'});`,
  '@/features/platform/owner-link': `exports.OwnerConsoleLink=()=>null;`,
  '@/features/identity/viewer-avatar': `exports.ViewerAvatar=props=>require('react').createElement('span',{'aria-label':props.name},'JM');`,
  './actions': `exports.updateProfile=async()=>({error:'Synthetic save failure. Your entries are preserved.'});exports.updateUsagePreference=async()=>{};exports.saveTimezone=async()=>({error:'Synthetic save failure.'});exports.bulkUpdateTickets=async()=>({error:'Synthetic save failure.'});exports.workTicket=async()=>({error:'Synthetic save failure.'});`,
  '@/app/app/tickets/view-actions': `exports.saveQueueView=async()=>({error:'Synthetic preview only. Views are not saved.'});exports.deleteQueueView=async()=>({error:'Synthetic preview only.'});`,
  '@/app/app/help/actions': `exports.saveArticle=async()=>({error:'Synthetic article save failure. Your draft is preserved.'});`,
  '@/app/app/notifications/actions': `exports.markNotificationsRead=async(_,data)=>{window.fixtureReadCommand=Object.fromEntries(data);return {error:'Synthetic failure. Try again.'};};`,
  '@/features/tickets/ticket-detail': `exports.TicketDetail=()=>null;`,
  '@/features/tickets/data': `exports.loadTicketQueue=async(_,filters)=>({view:'all',sort:'updated',search:filters.q||'',page:1,error:null,profiles:[],teams:[],knowledgeCount:0,tag:null,tagOptions:[],savedViews:[],savedViewsError:false,rows:filters.q?[ ]:[{id:'request-fixture',tags:[],title:'Pilot Wi-Fi request',ticket_number:42,status:'open',priority:'normal',request_kind:'ticket',updated_at:'2026-10-19T12:00:00Z',created_at:'2026-10-19T12:00:00Z',requester_id:'fixture',assigned_technician_id:null,team_id:null,due_at:null}]});`,
  'server-only': `module.exports={};`,
  '@/app/app/inventory/actions': `exports.inventoryMutation=async()=>({error:'Synthetic preview only.'});`,
  './sla-actions': `exports.saveSlaPolicy=async()=>({error:'Synthetic save failure. Your entries are preserved.'});`,
  '@/features/administration/sla-actions': `exports.saveSlaPolicy=async()=>({error:'Synthetic save failure. Your entries are preserved.'});`,
  '@/app/app/people/actions': `exports.resendMemberInvitation=async()=>({success:'Preview only. No email sent.'});exports.updateMemberDetails=async()=>({error:'Synthetic preview only.'});exports.deletePeople=async()=>({error:'Synthetic deletion failure. Your selection is preserved; try again.'});`,
  '@/app/app/assets/actions': `exports.saveAsset=async()=>({error:'Synthetic asset save failure. Your draft is preserved.'});exports.changeAssetLink=async()=>({error:'Synthetic preview only.'});`,
  '@/features/product-analytics/usage-event': `exports.UsageEvent=()=>null;`,
  // Async server component; the client-only preview cannot render it.
  '@/features/portal/service-announcements': `exports.ServiceAnnouncements=()=>null;`,
  'node:crypto': `exports.randomUUID=()=>crypto.randomUUID();`,
  '@/lib/auth/viewer': `exports.requireViewer=async()=>({id:'fixture',organizationId:'fixture',role:(new URLSearchParams(location.search).get('role')||sessionStorage.getItem('fixture-role')||'').startsWith('employee')?'end_user':'administrator',displayName:'Jordan Morgan',organizationName:'Example workspace',timeZone:'America/Tortola'});`,
  '@/lib/supabase/server': `exports.createClient=async()=>{const rows={profiles:[{display_name:'Jordan Morgan',email:'jordan@example.invalid',phone:'',job_title:'',department_id:null,location_id:null}],notifications:[{id:'notification-fixture',kind:'user_replied',title:'IT replied to your request',ticket_id:'request-fixture',conversation_id:null,created_at:'2026-10-19T12:00:00Z',read_at:null}],knowledge_articles:[{id:'article-fixture',title:'Connect to Wi-Fi',summary:'Reconnect your device to the wireless network.',category:'Network',status:'published',updated_at:'2026-10-19T12:00:00Z'}],assets:[{id:'asset-fixture',tag:'LT-0042',name:'Work laptop',kind:'computer',status:'assigned',serial_number:'PILOT-SN-42',model:'Example laptop',assigned_user_id:'fixture',location_id:null}]};const helpRows=[{id:'10000000-0000-4000-8000-000000000981',organization_id:null,title:'How are teams different from departments and ticket owners?',summary:'Understand who handles each request.',content:[{type:'paragraph',text:'A team groups the IT function handling a ticket. A department describes the requester’s business unit. The assigned technician is the individual owner.'}],help_collection:'fixxflow',help_topic:'getting-started',help_format:'faq',audience:'it_only',status:'published'}, {id:'10000000-0000-4000-8000-000000000982',organization_id:null,title:'Where can I see updates on my request?',summary:'Find your request and replies.',content:[{type:'paragraph',text:'Open My requests and choose the request. Its status, conversation, and expected reply and resolution times appear there.'}],help_collection:'fixxflow',help_topic:'requests',help_format:'faq',audience:'employees',status:'published'}, ...['employees','it_only'].map((audience,index)=>({id:'10000000-0000-4000-8000-00000000098'+(index+3),organization_id:null,title:audience==='employees'?'Get started and find the right feature':'Get started with ticket queues and ownership',summary:'Choose the right feature, follow your work, and keep conversations together.',content:[{type:'paragraph',text:'Getting started guide.'}],help_collection:'fixxflow',help_topic:'getting-started',help_format:'guide',audience,status:'published'})),{id:'10000000-0000-4000-8000-000000000985',organization_id:'fixture',title:'Reconnect your computer to Wi-Fi',summary:'Troubleshooting guidance from IT.',category:'Network',status:'published',audience:'employees',help_collection:'knowledge',help_format:'guide'}];
const source=table=>{if(['readable_knowledge_articles','library_articles'].includes(table)){let values=helpRows;let single=false;const query=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:single?values[0]:values,error:null}).then(resolve):(...args)=>{if(key==='eq'||key==='is')values=values.filter(row=>row[args[0]]===args[1]);if(key==='limit')values=values.slice(0,args[0]);if(key==='range')values=values.slice(args[0],args[1]+1);if(key==='single'||key==='maybeSingle')single=true;return query;}});return query;}let single=false;const query=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:single?(rows[table]||[])[0]:rows[table]||[],count:(rows[table]||[]).length,error:null}).then(resolve):()=>{if(key==='single'||key==='maybeSingle')single=true;return query;}});return query;};return {from:source,rpc:name=>name==='organization_sla_policy'?Promise.resolve({data:{version:0,targets:{critical:{response:15,resolution:240},high:{response:60,resolution:480},normal:{response:240,resolution:1440},low:{response:480,resolution:2880}},schedule:{days:[1,2,3,4,5,6,7],opens:420,closes:1320}},error:null}):source(name==='search_assets'?'assets':'knowledge_articles')};};`,
  '../actions': `exports.createTicket=async data=>{window.fixtureSubmitted=Object.fromEntries(data);if(!window.fixtureTicketRetried){window.fixtureTicketRetried=true;return {error:'Synthetic connection failure. Your request is preserved; try again.'};}return {redirectTo:'/app/tickets/fixture-created'};};`,
  '@/lib/supabase/client': `exports.createClient=()=>({realtime:{setAuth:async()=>{}},channel:()=>({on(){return this;},subscribe(fn){fn('SUBSCRIBED');return this;},track(){},send:async()=>({}),presenceState:()=>({})}),removeChannel(){},rpc:async(name,args)=>({data:[{id:args.message,author_id:'fixture',kind:'message',body:args.new_body,created_at:'2026-10-17T12:00:00Z',revision:args.expected_revision+1,edited_at:new Date().toISOString()}],error:null})});`,
  '@/app/app/chat/actions': `exports.startChat=async()=>({error:'Synthetic preview: no conversation was sent.'});`,
  'next/image': `exports.default=({fill,sizes,priority,unoptimized,...props})=>require('react').createElement('img',props);`,
  'next/navigation': `const React=require('react'); const subscribe=fn=>{window.addEventListener('popstate',fn);window.addEventListener('fixture-route',fn);return()=>{window.removeEventListener('popstate',fn);window.removeEventListener('fixture-route',fn);}};const notify=()=>window.dispatchEvent(new Event('fixture-route'));exports.usePathname=()=>React.useSyncExternalStore(subscribe,()=>window.location.pathname);exports.useSearchParams=()=>new URLSearchParams(React.useSyncExternalStore(subscribe,()=>window.location.search));exports.notFound=()=>{throw Error('notFound');};exports.useRouter=()=>({push:url=>{window.history.pushState({},'',url);notify();},replace:url=>{window.history.replaceState({},'',url);notify();},back:()=>window.history.back(),refresh:notify});`,
  'next/link': `exports.default=({children,scroll,prefetch,onNavigate,...props})=>require('react').createElement('a',props,children);`,
  '@/features/notifications/notification-link': `exports.NotificationLink=props=>require('react').createElement('a',{href:'/app/notifications',className:props.className,'aria-label':'Notifications',title:'Notifications'},require('react').createElement('svg',{viewBox:'0 0 24 24','aria-hidden':true},require('react').createElement('path',{d:'M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3Zm4 12h4'})),require('react').createElement('span',null,'Notifications'));`,
  '@/app/app/tickets/actions': `exports.updateTicket=async()=>({success:'Changes saved.',revision:2});exports.workTicket=async()=>({success:'Status saved.',revision:2});`,
};
supportPreviewMocks(mocks);
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
import {SessionWarning} from '@/features/auth/session-warning';
import {Button,buttonVariants} from '@/components/ui/button';import {Input,NativeSelect,Textarea} from '@/components/ui/input';import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {useSearchParams} from 'next/navigation';
import {WorkspaceNav} from '@/components/navigation/workspace-nav';
import {WorkspaceShell} from '@/components/navigation/workspace-shell';
import {Avatar} from '@/components/ui/avatar';
import {TicketQueueContext} from '@/features/tickets/queue-context';
import {MessageComposer} from '@/features/tickets/message-composer';
import {TicketWorkspace} from '@/features/tickets/ticket-workspace';
import {TicketMutationProvider} from '@/features/tickets/ticket-mutation-state';
import {TagSuggestions} from '@/features/tickets/tag-suggestions';
import {TicketWorkActions} from '@/features/tickets/work-actions';
import {SlaPolicyEditor} from '@/features/administration/sla-policy-editor';
import {defaultSlaTargets,defaultSlaSchedule} from '@/features/tickets/organization-sla';
import {TicketStatusBadge} from '@/features/tickets/ticket-status-badge';
import {ticketStatuses,ticketPriorities} from '@/features/tickets/presentation';
import {TicketDetailsForm} from '@/features/tickets/ticket-details-form';
import {OrganizationCreateForm} from '@/features/administration/organization-create-form';
import {OrganizationLocationList} from '@/features/administration/organization-location-item';
import {OrganizationItemRow} from '@/features/administration/organization-item-row';
import {SignupProgress} from '@/components/ui/signup-progress';
import {BrandLogo} from '@/components/brand/brand-logo';
import {AdministrationHub} from '@/features/administration/administration-hub';
import {EmployeeHome} from '@/features/portal/employee-home';
import {PageHeader} from '@/components/ui/page-header';
import {RouteError} from '@/components/route-error';
import {LiveSearchForm} from '@/components/ui/live-search-form';
import {ChatRoom} from '@/features/chat/chat-room';
import {ChatCenter} from '@/features/chat/chat-center';
import {ChatInbox} from '@/features/chat/chat-inbox';
import {StartChatForm,ChatIntakeGuide} from '@/features/chat/start-chat-form';
import AuthLayout from '@/app/(auth)/layout';
import NewTicketPage from '@/app/app/tickets/new/page';
import HelpPage from '@/app/app/help/page';
import FaqPage from '@/app/app/faq/page';
import AssetsPage from '@/app/app/assets/page';
import ProfilePage from '@/app/app/profile/page';
import NotificationsPage from '@/app/app/notifications/page';
import TicketsPage from '@/app/app/tickets/page';
import PeoplePage from '@/app/app/people/page';
import SupportDashboardPage from '@/app/app/support-dashboard/page';
import SharedIncidentsPage from '@/app/app/shared-incidents/page';
import SharedIncidentPage from '@/app/app/shared-incidents/[ticketId]/page';
import {PasswordFields} from '@/features/auth/password-fields';
import {InsightPermissionForm} from '@/features/support-viewer/permission-form';
import {IncidentSharingPanel} from '@/features/support-viewer/sharing-panel';
import {PersonCard} from '@/features/administration/person-card';
import {PeopleSelection,PersonSelection,DeletePeopleControl} from '@/features/administration/people-deletion-controls';
import {canDeletePerson} from '@/features/administration/people-deletion-model';
import {ThemeController} from '@/features/theme/theme-control';
import {AssetForm} from '@/features/assets/asset-form';
import {ArticleEditor} from '@/features/knowledge/article-editor';
import {CustomReportBuilder} from '@/features/reporting/custom-builder';
import {defaultReportDefinition} from '@/features/reporting/custom-model';
const ticket={id:'ticket-0',revision:1,status:'open',priority:'normal',assigned_technician_id:null,team_id:null,category_id:null,subcategory_id:null,location_id:null,due_at:null};
function DelayedPanel({children}) {const [ready,setReady]=useState(false);useEffect(()=>{const timer=setTimeout(()=>setReady(true),new URLSearchParams(location.search).has('late-panel')?1500:0);return ()=>clearTimeout(timer);},[]);return ready?children:<p role="status">Loading coordination…</p>;}
function Preview(){const params=useSearchParams();useEffect(()=>{if(params.get('open')==='faq')setTimeout(()=>{const question=document.querySelector('.fixxflow-faq-item');if(question)question.open=true;},250);},[params.toString()]);useEffect(()=>{if(params.get('surface')!=='people-deletion')return;const timer=setTimeout(()=>{if(params.get('selection')==='all'){const select=document.querySelector('.people-select-all input');if(select&&!select.checked)select.click();}setTimeout(()=>{if(params.get('disclosure')==='delete'){const item=document.querySelector(params.get('selection')==='all'?'.people-selection .people-delete':'.person-card .people-delete');if(item){const manage=item.closest('.person-manage');if(manage)manage.open=true;item.open=true;}}},0);},0);return()=>clearTimeout(timer);},[params.toString()]);useEffect(()=>{if(params.get('surface')!=='organization')return;const selector={add:'.organization-sublocation',edit:'.settings-editor:not(.organization-sublocation)',delete:'.organization-delete'}[params.get('disclosure')];if(selector){const disclosure=document.querySelector((params.get('entry')==='location'?'.organization-location-item ':'.organization-department-item ')+'.organization-entry-controls '+selector);if(disclosure)disclosure.open=true;}},[params.toString()]);if(params.get('role'))sessionStorage.setItem('fixture-role',params.get('role'));const selected=params.get('ticket')??undefined;const employee=['employee','employee-no-inventory'].includes(params.get('role')??sessionStorage.getItem('fixture-role')??'');const platform=params.get('role')==='platform';const [failed,setFailed]=useState(false);const [featurePage,setFeaturePage]=useState(null);const feature=params.get('ticket')?null:params.get('surface')||({ '/app/tickets/new':'new-ticket', '/app/help':'help','/app/faq':'faq', '/app/assets':'assets','/app/profile':'profile','/app/notifications':'notifications','/app/tickets':'tickets','/app/people':'people','/app/support-dashboard':'support-dashboard','/app/shared-incidents':'shared-incidents','/app/shared-incidents/70000000-0000-4000-8000-000000000001':'shared-incident' }[location.pathname]);useEffect(()=>{const Page=feature==='support-dashboard'?SupportDashboardPage:feature==='shared-incidents'?SharedIncidentsPage:feature==='shared-incident'?()=>SharedIncidentPage({params:Promise.resolve({ticketId:'70000000-0000-4000-8000-000000000001'})}):feature==='support-sharing'?()=>IncidentSharingPanel({organizationId:'fixture',ticketId:'70000000-0000-4000-8000-000000000001',eligible:true}):feature==='new-ticket'?NewTicketPage:feature==='help'?HelpPage:feature==='faq'?FaqPage:feature==='assets'?AssetsPage:feature==='profile'?ProfilePage:feature==='notifications'?NotificationsPage:feature==='tickets'?TicketsPage:feature==='people'?PeoplePage:null;if(Page)void Page({searchParams:Promise.resolve(Object.fromEntries(params))}).then(setFeaturePage);else setFeaturePage(null);},[feature,params.toString()]);const panel=<div className="page"><header className="page-header ticket-heading"><h2>VPN disconnects during video calls</h2></header><div className="ticket-layout"><div className="ticket-main"><section className="settings-card"><h2>Conversation</h2><p>Synthetic conversation fixture.</p><MessageComposer ticketId="ticket-0" action={async()=>({error:'Simulated failure. Your draft is preserved.'})}/></section></div><aside className="ticket-sidebar"><TicketDetailsForm ticket={ticket} timeZone="America/Tortola"/></aside></div></div>;
if(params.get('surface')==='auth')return <AuthLayout><section className="auth-card"><h1>Welcome back</h1><p className="auth-intro">Sign in to continue to your support workspace.</p><div className="stack"><label className="field"><span>Email address</span><Input type="email" placeholder="you@example.com"/></label><label className="field"><span>Password</span><Input type="password"/></label><Button variant="primary" type="button">Sign in</Button></div></section></AuthLayout>;
const previewChats=[{id:'fixture-chat',topic:'VPN connection',requester_id:'fixture',assigned_technician_id:'technician',status:'open',ticket_id:null,updated_at:'2026-10-17T12:01:00Z',preview:{body:'Hi Jordan, I can help. Are you working from home today?',author_id:'technician'},unread:1},{id:'fixture-closed',topic:'Laptop setup',requester_id:'fixture',assigned_technician_id:'technician',status:'closed',ticket_id:null,updated_at:'2026-10-16T12:00:00Z',preview:{body:'Thanks, that worked!',author_id:'fixture'}}];
const chatSurface=params.get('surface')==='chat-fixes'?<ChatCenter personal={employee} inbox={<ChatInbox chats={previewChats} names={new Map([['fixture','Jordan Morgan'],['technician','Casey Robinson']])} failed={false} view="open" organizationId="fixture" viewerId="fixture" personal={employee} selectedId="fixture-chat"/>}><section className="chat-active"><header className="chat-active-header"><a className={buttonVariants({variant:'quiet',className:'chat-back'})} href="/app/chat">← My chats</a><Avatar name={employee?'Casey Robinson':'Jordan Morgan'}/><div className="chat-active-identity"><h2>{params.get('unassigned')==='1'?'Hi this is a test from phone':'VPN connection'}</h2><p>{employee?'Chatting with Casey Robinson':'Jordan Morgan'} · Open</p></div></header><div className="chat-active-body"><ChatRoom conversationId="fixture-chat" organizationId="fixture" viewerId="fixture" isWorker={!employee} open names={{technician:'Casey Robinson'}} supportName={params.get('unassigned')==='1'?'IT support team':'Casey Robinson'} assigned={params.get('unassigned')!=='1'} participantId="technician" initialMessages={[{id:'fixture-message',author_id:'fixture',kind:'message',body:'I cant connect to the VPN.',created_at:'2026-10-17T12:00:00Z',revision:1,edited_at:null},{id:'fixture-reply',author_id:'technician',kind:'message',body:'Hi Jordan, I can help. Are you working from home today?',created_at:'2026-10-17T12:01:00Z',revision:1,edited_at:null}]} attachments={[{id:'fixture-file',file_name:'Connection screenshot.png',size_bytes:2048,created_at:'2026-10-17T12:00:30Z',storage_path:'fixture',content_type:'image/png',uploaded_by:'fixture',url:'/brand/fixxflow/icon/fixxflow-icon-primary.png'}]}/></div></section></ChatCenter>:params.get('surface')==='chat-intake'?<div className="portal-page chat-intake-page"><PageHeader title="Start a chat" eyebrow="Your IT support" description="Tell us what’s happening. We’ll take it from here." back={{href:'/app/chat',label:'Back to chats'}}/><div className="chat-intake-layout"><StartChatForm submissionKey="90000000-0000-4000-8000-000000000001"/><ChatIntakeGuide/></div></div>:null;
const requestsSurface=params.get('surface')==='requests-search'?<div className="portal-page"><header className="portal-page-heading"><div><h1>My requests</h1><p>See updates, read replies, and continue a conversation with IT.</p></div></header><LiveSearchForm action="/app/tickets" className="portal-search" label="Search requests" resultSummary="No requests found."><label htmlFor="ticket-search">Search requests</label><div><Input id="ticket-search" name="q" type="search" aria-describedby="ticket-search-hint" placeholder="Words or #ticket number"/><Button variant="secondary">Search</Button></div></LiveSearchForm><p id="ticket-search-hint" className="muted">Matches any part, ignoring case. Use # for an exact ticket number.</p></div>:null;
const toolsSurface=params.get('surface')==='asset-editor'?<div className="page"><PageHeader title="Add asset"/><AssetForm/></div>:params.get('surface')==='article-editor'?<div className="page"><PageHeader title="New article"/><ArticleEditor isNew organizationId="fixture" assets={[]} related={[{id:'related-fixture',title:'Related help guide'}]} article={{id:'article-fixture',title:'Pilot guide',summary:'',category:'Network',content:[{type:'paragraph',text:'Pilot content'}],status:'draft',related_article_ids:['related-fixture'],revision:1}}/></div>:params.get('surface')==='report-builder'?<div className="page"><PageHeader title="Custom report"/><CustomReportBuilder definition={defaultReportDefinition('2026-10-19')} references={{categories:[],subcategories:[],teams:[],technicians:[],departments:[],locations:[]}}/></div>:null;
const workflowSurface=params.get('surface')==='sla-settings'?<div className="page stack"><PageHeader title="SLAs" eyebrow="Settings" description="First response and resolution targets by priority." back={{href:'/app/administration',label:'Back to settings'}}/><section className="settings-card"><SlaPolicyEditor policy={{version:0,targets:defaultSlaTargets,schedule:params.get('custom')?{days:[1,2,3,4,5],opens:540,closes:1020}:defaultSlaSchedule}} timeZone="America/Tortola"/></section></div>:params.get('surface')==='ticket-badges'?<div className="page stack"><section className="settings-card stack"><h2>Ticket statuses</h2>{Object.keys(ticketStatuses).map(status=><TicketStatusBadge key={status} status={status}/>)}</section><section className="settings-card stack"><h2>Ticket priorities</h2>{Object.keys(ticketPriorities).map(priority=><TicketStatusBadge key={priority} priority={priority}/>)}</section></div>:params.get('surface')==='ticket-work-actions'?<div className="page"><TicketWorkActions ticket={{id:'ticket-fixture',revision:1,status:'open',assigned_technician_id:null}} assignee="Unassigned"/></div>:params.get('surface')==='ticket-workflow'?<div className="page"><div className="ticket-topbar"><a href="/app/tickets" className={buttonVariants({variant:'quiet'})}>Back to tickets</a><div className="ticket-topbar-actions"><a href="#ticket-assignment" className={buttonVariants({variant:'secondary'})}>Assignment &amp; details</a><span>#1010</span></div></div><header className="page-header ticket-heading"><div><div className="ticket-heading-badges"><span className="ticket-badge">New</span><span className="ticket-badge">High</span></div><h1>Office network interruption</h1><p>Requested by Jordan Morgan · October 30</p></div></header><TicketMutationProvider><TicketWorkspace activeWorkflow={false} review={<section className="settings-card"><h3>Request from Jordan Morgan</h3><p className="ticket-description">Since this morning, the office network disconnects every few minutes. The team cannot access shared files or join meetings.</p><p>Impact: Work blocked · 2 attachments</p><a href="#ticket-files">View files</a></section>} assignment={<><TicketWorkActions ticket={{id:'ticket-fixture',revision:1,status:'open',assigned_technician_id:'fixture'}} assignee="J. Hodge" compact/><p>Priority: High · <a href="#ticket-assignment">Edit details</a></p><p>Response met · Resolve in 3h 10m</p></>} conversation={<section className="settings-card"><div className="section-heading-row"><h3>Conversation</h3><a href="#ticket-activity">View history</a></div><p><strong>Jordan Morgan</strong> · Today, 9:15 AM</p><p>The connection still drops after restarting.</p><MessageComposer ticketId="ticket-fixture" revision={1} lazySavedReplies ticketStatus={(params.get('ticket-status')||'open') as any} action={async()=>({success:'Reply sent.'})} statusAction={async data=>params.has('reply-conflict')?({messageSent:false,statusChanged:false,conflict:true,error:'Reply not sent. Review the latest ticket; your draft is preserved.'}):({messageSent:true,statusChanged:true,success:data.get('status')==='waiting_on_user'?'Reply sent. Waiting on the requester’s reply; resolution SLA paused.':'Reply sent. Ticket resolved.'})}/></section>} details={<><details className="ticket-disclosure" id="ticket-assignment"><summary>Edit details</summary><label>Priority<NativeSelect><option>High</option><option>Normal</option></NativeSelect></label><Button>Save details</Button></details><details className="ticket-disclosure"><summary>Tags · Network, Office</summary><TagSuggestions ticketId="ticket-fixture" tags={['network','office']}/></details><details className="ticket-disclosure"><summary>Add links</summary><Input aria-label="Ticket number"/></details><details className="ticket-disclosure"><summary>Watchers · A. Smith</summary><Button>Follow updates</Button></details><details className="ticket-disclosure"><summary>Add assets</summary><Input aria-label="Asset"/></details></>} files={<p>Screenshot.png · Network-log.txt</p>} resolution={<p>Waiting on user and documented holds pause resolution only.</p>} history={<p>J. Hodge started work · Today, 9:20 AM</p>} tools={<DelayedPanel><section id="communication-plan" className="settings-card stack"><h2>Employee announcement</h2><label className="field">Title (required)<Input required name="title"/></label><label className="field">Status<NativeSelect name="status"><option>Investigating</option><option>Working on a fix</option><option>Monitoring</option></NativeSelect></label><label className="field">Message (required)<Textarea required name="message" rows={5}/></label><Button type="button">Publish announcement</Button></section></DelayedPanel>}/></TicketMutationProvider></div>:null;
const organizationSurface=params.get('surface')==='organization'?<div className="page organization-page"><PageHeader title="Organization"/><div className="settings-grid"><section className="settings-card"><h2>Departments</h2><div className="management-list">{[
{id:'department-admin',name:'Administration',description:'Includes Accounting, HR, etc',is_active:true},
{id:'department-engineering',name:'Engineering',description:'Building maintenance, equipment repairs, electrical systems and support for all facilities across the resort.',is_active:true},
{id:'department-archived',name:'Former operations',description:null,is_active:false},
{id:'department-long',name:'DepartmentWithAnUnbrokenNameThatMustWrapWithoutPushingItsControlsOffScreen',description:'DescriptionWithAnUnbrokenReferenceThatMustWrapWithoutWideningThePage'.repeat(3),is_active:true}
].map(item=><OrganizationItemRow key={item.id} kind="department" item={{updated_at:'2026-11-01T12:00:00Z',...item}} toggleAction={async()=>{}} deleteAction={async()=>{}}/>)}</div></section><section className="settings-card"><h2>Locations</h2><OrganizationLocationList items={[
{id:'30000000-0000-4000-8000-000000000001',name:'Admin Building',path:'Admin Building',parent_id:null,depth:1,is_active:true,country_code:'VG'},
{id:'30000000-0000-4000-8000-000000000002',name:'First floor',path:'Admin Building / First floor',parent_id:'30000000-0000-4000-8000-000000000001',depth:2,is_active:true,country_code:'VG'},
{id:'30000000-0000-4000-8000-000000000003',name:'Retired storage',path:'Retired storage',parent_id:null,depth:1,is_active:false,country_code:null},
{id:'30000000-0000-4000-8000-000000000004',name:'Equipment storage room',path:'Admin Building / First floor / Equipment storage room with a very long location name',parent_id:'30000000-0000-4000-8000-000000000002',depth:3,is_active:true,country_code:'VG'}
].map(item=>({city:null,region:null,timezone:'America/Tortola',updated_at:'2026-11-01T12:00:00Z',...item}))} addAction={async()=>({error:'Synthetic save failure. Your entries are preserved.'})} toggleAction={async()=>{}} deleteAction={async()=>{}}/></section></div></div>:null;
const previewPeople=[{id:'10000000-0000-4000-8000-000000000901',name:'Jordan Morgan',email:'jordan@example.invalid',role:params.get('role')==='technician'?'technician':'administrator'},{id:'10000000-0000-4000-8000-000000000902',name:'Alex Rivers',email:'alex.rivers@example.invalid',role:'end_user'},{id:'10000000-0000-4000-8000-000000000903',name:'Casey Robinson',email:'casey.robinson@example.invalid',role:'technician'},{id:'10000000-0000-4000-8000-000000000904',name:'Taylor Example-With-A-Long-Name',email:'taylor.long.email.address@example.invalid',role:'end_user'}];
const viewerRole=params.get('role')==='technician'?'technician':'administrator';const eligible=previewPeople.filter(person=>canDeletePerson(viewerRole,person.role,person.id===previewPeople[0].id));
const peopleDeletionSurface=params.get('surface')==='people-deletion'?<div className="page people-page"><PageHeader title="People" description="Manage workspace access and directory entries."/><section className="people-directory"><header className="people-directory-heading"><div><h2>Your workspace</h2><p>Everyone with access to this workspace</p></div></header><PeopleSelection people={eligible} search="" view=""><ul className="people-list">{previewPeople.map(person=><PersonCard key={person.id} id={person.id} name={person.name} email={person.email} role={person.role} status={person.id===previewPeople[1].id?'invited':person.id===previewPeople[3].id?'inactive':'active'} isSelf={person.id===previewPeople[0].id} canManage={viewerRole==='administrator'} profile={person.id===previewPeople[0].id?{user_id:person.id,job_title:'IT Manager',department_id:null,location_id:null,updated_at:'2026-11-01'}:undefined} departments={[]} locations={[]} updateRole={async()=>{}} updateStatus={async()=>{}} selection={eligible.includes(person)?<PersonSelection id={person.id} name={person.name}/>:undefined} deleteControl={eligible.includes(person)?<DeletePeopleControl people={[person]}/>:undefined}/>)}</ul></PeopleSelection></section></div>:null;
const errorSurface=params.get('surface')==='route-error'?<RouteError layout="narrow" retry={()=>{window.fixtureRetried=true;}} title="This page could not load" message="We couldn’t retrieve the information for this page. Please try again." back={{href:'/app',label:'Back to overview'}}/>:null;
const sessionWarning=params.get('surface')==='session-warning'?<SessionWarning remaining={91000} onStay={()=>{window.fixtureStayed=true;}} onSignOut={()=>{window.fixtureSignedOut=true;}}/>:null;
const passwordSetup=params.get('surface')==='password-requirements'?<div className="page page-narrow stack"><section className="auth-card stack"><h1>Choose a new password</h1><p className="auth-intro">The checklist updates as you type. This is a local preview; no password is sent or saved.</p><form className="stack" onSubmit={event=>event.preventDefault()}><PasswordFields/><Button type="submit" variant="primary">Check password</Button></form></section></div>:null;
const insightPermissions=params.get('surface')==='support-permissions'?<div className="page page-narrow stack"><PageHeader title="Employee support insights" description="Preview the optional permissions in People → Manage."/><section className="settings-card"><InsightPermissionForm name="Alex Rivera" member={{userId:'10000000-0000-4000-8000-000000000001',dashboard:true,sharedIncidents:true,revision:1}}/></section></div>:null;
const content=<>{sessionWarning}{passwordSetup??insightPermissions??errorSurface??peopleDeletionSurface??organizationSurface??workflowSurface??toolsSurface??featurePage??chatSurface??requestsSurface??(params.get('surface')==='administration'?<AdministrationHub organizationName="Example workspace"/>:employee?<EmployeeHome firstName="Jordan" greeting="Good afternoon" organizationName="Example workspace" recent={[]}/>:<TicketQueueContext returnTo="/app/tickets?view=all" selected={selected} panel={selected?panel:null}><div dangerouslySetInnerHTML={{__html:window.fixtureQueue}}/></TicketQueueContext>)} {!employee&&!passwordSetup&&!insightPermissions&&!errorSurface&&!peopleDeletionSurface&&!organizationSurface&&!chatSurface&&!featurePage&&!toolsSurface&&!workflowSurface&&<section className="page stack"><SignupProgress current={2}/><h2>Create a location</h2><OrganizationCreateForm kind="location" timezone="America/Tortola" action={async()=>{if(!failed){setFailed(true);return {error:'Review the location details.',fieldErrors:{name:'That name already exists. Choose another name.'}};}return {success:'Location added in fixture.'};}}/></section>}</>;return <WorkspaceShell audience={employee?"employee":"staff"} brand={<BrandLogo variant="navigation" className="sidebar-logo"/>} navigation={<WorkspaceNav insightAccess={{dashboard:true,sharedIncidents:true}} role={employee?'end_user':params.get('role')==='technician'?'technician':'administrator'} organizationId="fixture" userId="fixture" inventoryAccess={params.get('role')!=='employee-no-inventory'} platform={platform}/>} account={<div className="sidebar-account"><Avatar name="Jordan Morgan"/><div className="account-copy"><strong>Jordan Morgan</strong><span>{employee?'Employee':'Administrator'}</span></div><button className="sign-out-button" type="button" aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H5v16h4m7-4 4-4-4-4m4 4H9"/></svg></button></div>}>{content}</WorkspaceShell>}
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
    // Shared and feature module styles with kit utilities, compiled per request so edits show on reload.
    compiledProductStyles().then(
      (css) => response.end(css),
      (error) => {
        response.statusCode = 500;
        response.end(String(error));
      },
    );
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
            : resource === 'location_parents'
              ? [
                  {
                    id: '30000000-0000-4000-8000-000000000001',
                    label: 'Admin Building',
                    active: true,
                    parent_id: null,
                  },
                ]
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
  if (url.pathname === '/app/tickets/choices') {
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','private, no-store');
    response.end(JSON.stringify({items:url.searchParams.get('kind')==='tags'?['network','vpn','office']: [{id:'fixture-reply',title:'Reconnect to the network',body:'Hi {{requester_name}}, please reconnect and tell us what happens.'}]}));return;
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
      (url.searchParams.has('theme') ? ';document.documentElement.dataset.themePreference=document.documentElement.dataset.theme=' + JSON.stringify(url.searchParams.get('theme') === 'dark' ? 'dark' : 'light') : '') +
      '</script><style>@font-face{font-family:Inter;src:url(/brand/fixxflow/fonts/InterVariable.woff2) format(woff2);font-weight:100 900}:root{--font-inter:Inter}</style><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script>window.fixtureQueue=' +
      JSON.stringify(queueHtml).replaceAll('<', '\\u003c') +
      ';</script><script src="/bundle.js"></script></body></html>',
  );
});
const port = Number(process.argv[2]) || 4183;
server.listen(port, '127.0.0.1', () => console.log(`Interface preview: http://127.0.0.1:${port}`));
