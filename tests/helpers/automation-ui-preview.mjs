/** Isolated browser fixture: real components/CSS, mocked server actions only.
 * Run with node tests/helpers/automation-ui-preview.mjs. No application database,
 * credentials, persisted rules, execution or processing controls are accessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import ts from 'typescript';
const root=process.cwd(),modules=new Map(),ids=new Map();
const mocks={
  'next/navigation':`exports.useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});`,
  '@/app/app/administration/automations/actions':`
const {validateDefinition}=require('@/features/automation/validation');
const {persistenceRegistry}=require('@/features/automation/persistence-contract');
const {ticketDryRunEvent}=require('@/features/automation/domains/tickets/dry-run-context');
const {evaluateDryRun}=require('@/features/automation/dry-run');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const choices={teams:[{id:id(11),label:'Network Team',active:true}],ticket_categories:[{id:id(12),label:'Network',active:true},{id:id(13),label:'Software',active:true}],active_ticket_workers:[{id:id(14),label:'David Rivera',active:true}],tickets:[{id:id(18),label:'Ticket #1842 · Network access',active:true}]};
exports.findAutomationChoices=async(resource,query,page,selected=[])=>({ok:true,value:{rows:(choices[resource]||[]).filter(r=>selected.length?selected.includes(r.id):r.label.toLowerCase().includes(query.toLowerCase())),hasNext:false}});
exports.findAutomationEvents=async()=>({ok:true,value:{rows:[{id:id(19),event_type:'ticket.created',occurred_at:'2026-10-01T10:00:00Z',entity_version:1}],hasNext:false}});
exports.saveAutomationDraft=async(ruleId,version,definition)=>{
 if(definition.name==='Conflict')return{ok:false,error:{code:'conflict',message:'Changed'}};
 const result=validateDefinition(definition,persistenceRegistry);if(!result.valid)return{ok:false,error:{code:'invalid_definition',message:'Check the definition.',issues:result.issues}};
 return{ok:true,value:{rule:{id:ruleId||id(2),organizationId:id(1),version:(version||0)+1,enabled:false,definition:result.value,createdBy:id(3),createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'}}};
};
exports.runAutomationTest=async(input)=>{
 const validated=validateDefinition(input.definition.value,persistenceRegistry);
 if(!validated.valid)return{result:{ok:false,notice:'No changes were made.',sideEffectsPerformed:false,error:{message:'Check the draft before testing.',issues:validated.issues}},labels:{}};
 const context={organizationId:id(1),ticketId:id(18),ticketNumber:1842,revision:3,evaluatedAt:'2026-10-01T10:00:00Z',snapshot:{created_at:'2026-10-01T09:00:00Z',unassigned_since:null,unassigned_episode_id:null,waiting_on_user_since:null,waiting_on_user_episode_id:null,response_sla_due_at:'2026-10-01T10:15:00Z',resolution_sla_due_at:'2026-10-01T11:00:00Z',first_response_at:null,resolved_at:null,closed_at:null,title:'Network access',priority:'critical',status:'new',requester_id:id(3),category_id:id(12),subcategory_id:null,assigned_technician_id:id(14),team_id:null,location_id:null,requester_department_id:null},definition:validated.value,ruleId:null,ruleVersion:null,event:null,storedEnabled:null,storedArchived:false,conditionsReferencesValid:true,actionReferences:validated.value.actions.map(a=>({actionId:a.id,valid:true}))};
 if(input.source.kind==='retained_event'){context.event={...ticketDryRunEvent(context,{kind:'current_ticket'}),id:id(19),entityVersion:1};}
 return{result:{ok:true,value:evaluateDryRun(context,ticketDryRunEvent(context,input.source),input.source,persistenceRegistry)},labels:{[id(12)]:'Network',[id(13)]:'Software'}};
};`,
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
const entry=add(path.join(root,'tests/fixtures/automation-preview-entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';import {CreateAutomation} from '@/features/automation/create-automation';
createRoot(document.getElementById('root')!).render(<div className="page automation-page"><p className="alert alert-info">Isolated UI fixture · processing OFF · no database connection</p><header className="page-header"><div><span className="page-eyebrow">Administration</span><h1>Create Automation</h1><p>Choose when to act, what must match and what happens next.</p></div></header><CreateAutomation/></div>);`);
const bundle=`var process={env:{NODE_ENV:'development'}};var global=globalThis;(()=>{const modules={${[...modules].map(([id,code])=>`${id}:(require,module,exports)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${entry});})();`;
const server=http.createServer((request,response)=>{
 if(request.url==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle);}
 else if(request.url==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync('src/app/globals.css'));}
 else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automation UI test fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
});
server.listen(4179,'127.0.0.1',()=>console.log('Isolated automation preview: http://127.0.0.1:4179'));
