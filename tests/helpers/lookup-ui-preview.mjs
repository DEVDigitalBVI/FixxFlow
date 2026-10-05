/** Isolated lookup/form browser fixture. No database, credentials or real saves. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import ts from 'typescript';
const root=process.cwd(),modules=new Map(),ids=new Map();
const mocks={'next/navigation':`exports.useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});`};
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
const entry=add(path.join(root,'tests/fixtures/lookup-preview-entry.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {LookupSelect} from '@/features/lookups/lookup-select';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
function Preview(){const [fail,setFail]=useState(false);const [saved,setSaved]=useState(false);
return <main id="main-content" className="page page-narrow"><h1>Lookup and recovery checks</h1><p>Isolated fixture · no database or real saves</p><label><input type="checkbox" checked={fail} onChange={event=>{setFail(event.target.checked);window.fixtureFailure=event.target.checked;}}/> Simulate lookup failure</label><ActionForm className="settings-card" action={async data=>{if(data.has('lookupLoadError'))return {error:'Choices could not load. Retry before saving.'};if(!saved){setSaved(true);return {error:'Simulated save failure. Your entries are preserved.'};}return {success:'Saved fixture.'};}}><label className="field">Draft title<input className="input" name="title" defaultValue="Keep this draft"/></label><div className="form-grid"><LookupSelect resource="people" name="requesterId" label="Requester" defaultValue="person-1205"/><LookupSelect resource="locations" name="locationId" label="Location"/></div><SubmitButton className="button button-primary">Save fixture</SubmitButton></ActionForm></main>}
const originalFetch=window.fetch;window.fetch=(url,options)=>window.fixtureFailure?Promise.resolve(new Response('{}',{status:503})):originalFetch(url,options);
createRoot(document.getElementById('root')!).render(<Preview/>);`);
const bundle=`var process={env:{NODE_ENV:'development'}};var global=globalThis;(()=>{const modules={${[...modules].map(([id,code])=>`${id}:(require,module,exports)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${entry});})();`;

const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle);}
 else if(url.pathname==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync('src/app/globals.css'));}
 else if(url.pathname==='/app/lookups'){
  const rows=Array.from({length:1205},(_,i)=>({id:'person-'+(i+1),label:(i===1204?'A long selected name repeated to check wrapping and native select sizing on narrow screens — ':'Person ')+String(i+1).padStart(4,'0'),active:true,parent_id:null}));
  const query=(url.searchParams.get('q')||'').toLowerCase(),start=Number(url.searchParams.get('cursor')||0),filtered=rows.filter(row=>row.label.toLowerCase().includes(query));
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({rows:filtered.slice(start,start+50),selected:rows.find(row=>row.id===url.searchParams.get('selected'))??null,next:filtered.length>start+50?String(start+50):null}));
 }else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lookup recovery fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
});
server.listen(4180,'127.0.0.1',()=>console.log('Lookup preview: http://127.0.0.1:4180'));
