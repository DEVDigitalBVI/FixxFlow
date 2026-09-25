import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {duration,topRows} from './model.ts';
const require=createRequire(import.meta.url);
function load(file,mocks={}) {const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
test('duration distinguishes no samples, sub-minute responses, and hours',()=>{
 assert.equal(duration(null),'No data');assert.equal(duration(0),'<1m');assert.equal(duration(18),'18m');assert.equal(duration(192),'3.2h');
});
test('top categories preserve totals when grouping the tail',()=>{
 const rows=Array.from({length:15},(_,i)=>({label:`Group ${i}`,value:i+1}));const result=topRows(rows);
 assert.equal(result.length,11);assert.equal(result.at(-1).label,'Other groups');assert.equal(result.reduce((n,r)=>n+r.value,0),120);
});
test('employee cannot request reports and failures never masquerade as zeros',async()=>{
 let calls=0;
 const mocks={'next/link':{default:props=>React.createElement('a',props)},'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},'@/lib/auth/viewer':{requireViewer:async()=>({role:'end_user',organizationId:'org'})},'@/features/reporting/data':{getReport:async()=>{calls++;return null;}},'@/features/reporting/components':{ReportUnavailable:()=>React.createElement('div',{role:'alert'},'Unavailable')}};
 const page=()=>load('src/app/app/reports/page.tsx',mocks).default();
 await assert.rejects(page,/NOT_FOUND/);assert.equal(calls,0);
 mocks['@/lib/auth/viewer'].requireViewer=async()=>({role:'technician',organizationId:'org'});
 assert.match(renderToStaticMarkup(await page()),/role="alert"/);assert.equal(calls,1);
});
test('charts provide labeled data tables and distinguish empty timing samples',()=>{
 const {Trend,Bars}=load('src/features/reporting/components.tsx',{'next/link':{default:props=>React.createElement('a',props)},'./model':{duration,topRows}});
 const html=renderToStaticMarkup(React.createElement(Trend,{title:'Response time',description:'Timing',days:['2026-09-24','2026-09-25'],series:[{label:'Response',values:[null,18]}],time:true}));
 assert.match(html,/role="img"/);assert.match(html,/<caption>/);assert.match(html,/scope="row"/);assert.match(html,/No data/);assert.match(html,/18m/);
 const empty=renderToStaticMarkup(React.createElement(Bars,{title:'SLA compliance',description:'Completed targets',rows:[],percent:true}));assert.match(empty,/No completed SLA/);assert.doesNotMatch(empty,/100%/);
});
