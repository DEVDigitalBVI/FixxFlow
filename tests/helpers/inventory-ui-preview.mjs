/** Isolated lookup/form browser fixture. No database, credentials or real saves. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import ts from 'typescript';
const root=process.cwd(),modules=new Map(),ids=new Map();
const mocks={
 'next/image':`exports.default=({fill,sizes,...props})=>require('react').createElement('img',props);`,
 '@/features/administration/member-details-editor':`exports.MemberDetailsEditor=()=>require('react').createElement('p',null,'Profile details editor · isolated fixture');`,
 'next/navigation':`exports.useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});`,
 'next/link':`exports.default=({children,...props})=>require('react').createElement('a',props,children);`,
 '@/app/app/inventory/actions':`exports.inventoryMutation=async()=>{if(!window.fixtureRetried){window.fixtureRetried=true;return {error:'Simulated save failure. Your entries are preserved.'};}return {success:'Inventory fixture saved.'};};`
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
const entry=add(path.join(root,'tests/fixtures/inventory-preview-entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {RequestForm,StockForm,IssueForm,PermissionsForm} from '@/features/inventory/forms';
import {InventoryTable,InventoryStockSummary} from '@/features/inventory/inventory-table';
import {PageHeader} from '@/components/ui/page-header';
import {PersonCard} from '@/features/administration/person-card';
const item={id:'item',name:'Toner for department printer',kind:'consumable',department_name:'Engineering',location_name:'Central storage',stock:12,reserved:3};
const request={id:'request',item_id:'equipment',quantity:1,recipient_id:null,destination:'Engineering office',context:{item:'Laptop'}};
function Preview(){return <main id="main-content" className="page stack"><PageHeader title="Department inventory" eyebrow="FixxFlow · Engineering" description="Stock stored centrally, allocated to each department." actions={<><a className="button button-secondary" href="#history">Review requests</a><a className="button button-primary" href="#receive">Receive stock</a></>}/><p className="muted">Isolated fixture · no database or real saves</p><section className="asset-inventory"><div className="asset-inventory-heading"><div><h2>Stock by department</h2><p className="muted">Available stock excludes reservations for approved requests.</p></div><span className="muted">1 item type</span></div><div className="asset-inventory-toolbar"><form className="asset-search"><label className="field asset-search-query">Department<select className="input"><option>All departments</option><option>Engineering</option></select></label><button className="button button-secondary">Filter inventory</button></form></div><InventoryTable items={[item]}/></section><InventoryStockSummary item={item}/><section className="settings-card stack"><h2>Request an item</h2><RequestForm item={item} token="request-retry"/></section><section className="settings-card stack"><h2>Equipment receipt</h2><StockForm item={{...item,kind:'equipment'}} command="receive" token="receipt-retry"/></section><section className="settings-card stack"><h2>Actual handover</h2><IssueForm request={request} units={[{asset_id:'asset',asset_context:{tag:'PC-001',name:'Laptop',serial:'SN-001'}}]} token="issue-retry"/></section><section className="settings-card stack"><h2>People permissions</h2><PermissionsForm id="person" name="Pat" departments={[{id:'engineering',name:'Engineering',is_active:true},{id:'finance',name:'Finance',is_active:true}]} grants={['engineering']} manager={false} token="permissions-retry"/></section></main>}
function PeoplePreview(){return <main className="page people-page"><PageHeader title="People" description="Isolated preview · no database or real permission changes"/><section className="people-directory"><ul className="people-list"><PersonCard id="pat" name="Pat Rivers" email="pat@example.invalid" role="administrator" status="active" isSelf canManage departments={[]} locations={[]} updateRole={async()=>{}} updateStatus={async()=>{}} inventoryPermissions={<PermissionsForm id="pat" name="Pat Rivers" departments={[{id:'engineering',name:'Engineering',is_active:true},{id:'finance',name:'Finance',is_active:true},{id:'operations',name:'Operations and facilities management with a longer department name',is_active:true}]} grants={['engineering']} manager={false} token="permissions-retry"/>}/></ul></section></main>}
createRoot(document.getElementById('root')!).render(window.location.pathname.startsWith('/people')?<PeoplePreview/>:<Preview/>);`);
const bundle=`var process={env:{NODE_ENV:'development'}};var global=globalThis;(()=>{const modules={${[...modules].map(([id,code])=>`${id}:(require,module,exports)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${entry});})();`;

const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 if(url.pathname==='/compact'){const width=[375,768,1024].includes(Number(url.searchParams.get('width')))?Number(url.searchParams.get('width')):375;const surface=url.searchParams.get('surface')==='people'?'/people':'/preview';response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html lang="en"><head><title>Compact inventory fixture</title></head><body><h1>${width}px inventory viewport</h1><iframe title="Compact inventory" src="${surface}" style="width:${width}px;height:850px;border:1px solid gray"></iframe></body></html>`);}
 else if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle);}
 else if(url.pathname==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync('src/app/globals.css'));}
 else if(url.pathname==='/app/lookups'){
  const rows=Array.from({length:1205},(_,i)=>({id:'person-'+(i+1),label:(i===1204?'A long selected name repeated to check wrapping and native select sizing on narrow screens — ':'Person ')+String(i+1).padStart(4,'0'),active:true,parent_id:null}));
  const query=(url.searchParams.get('q')||'').toLowerCase(),start=Number(url.searchParams.get('cursor')||0),filtered=rows.filter(row=>row.label.toLowerCase().includes(query));
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({rows:filtered.slice(start,start+50),selected:rows.find(row=>row.id===url.searchParams.get('selected'))??null,next:filtered.length>start+50?String(start+50):null}));
 }else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en"'+(url.pathname.endsWith('-light')?' data-theme="light"':url.pathname.endsWith('-dark')?' data-theme="dark"':'')+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inventory interaction fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
});
server.listen(4182,'127.0.0.1',()=>console.log('Inventory preview: http://127.0.0.1:4182'));
