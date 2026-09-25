import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(file,mocks={}){
 const filename=path.resolve(file);const m={exports:{}};
 const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',compiled)(name=>name in mocks?mocks[name]:name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts'),mocks):require(name),m,m.exports);return m.exports;
}
const {ArticleContent}=load('src/features/knowledge/article-content.tsx');
test('rich text is rendered semantically and raw HTML is escaped',()=>{
 const html=renderToStaticMarkup(React.createElement(ArticleContent,{content:[{type:'heading',text:'Steps'},{type:'paragraph',text:'**Bold** and *italic* <script>alert(1)</script>'},{type:'list',text:'First\nSecond'}]}));
 assert.match(html,/<h2>Steps<\/h2>/);assert.match(html,/<strong>Bold<\/strong>/);assert.match(html,/<em>italic<\/em>/);assert.match(html,/<ul><li>First/);assert.doesNotMatch(html,/<script>/);
});
test('image sources only come from authorized asset mapping and retain alt text',()=>{
 const id='10000000-0000-0000-0000-000000000001';
 const html=renderToStaticMarkup(React.createElement(ArticleContent,{content:[{type:'image',text:'Network settings',assetId:id,url:'https://tracking.test'}],images:{[id]:'/app/help/assets/'+id}}));
 assert.match(html,/alt="Network settings"/);assert.doesNotMatch(html,/tracking.test/);
});
test('employee article edits are rejected before database access',async()=>{
 const {saveArticle}=load('src/app/app/help/actions.ts',{'next/cache':{revalidatePath(){}},'@/lib/auth/viewer':{requireViewer:async()=>({role:'end_user'})},'@/lib/supabase/server':{createClient:()=>{throw Error('Must not query');}},'@/features/knowledge/content':load('src/features/knowledge/content.ts')});
 assert.match((await saveArticle(new FormData())).error,/Only IT/);
});
test('article editor uses labeled native controls and keyboard block ordering',()=>{
 const {ArticleEditor}=load('src/features/knowledge/article-editor.tsx',{'next/navigation':{useRouter:()=>({push(){},refresh(){}})},'@/app/app/help/actions':{saveArticle:async()=>({})},'@/lib/supabase/client':{createClient:()=>({})},'./article-content':{ArticleContent:()=>null}});
 const html=renderToStaticMarkup(React.createElement(ArticleEditor,{article:{id:'10000000-0000-0000-0000-000000000001',title:'Draft',summary:'',category:'Network',status:'draft',revision:1,content:[{type:'paragraph',text:'Example'}],related_article_ids:[]},organizationId:'org',assets:[],related:[],isNew:true}));
 assert.match(html,/Draft — IT staff only/);assert.match(html,/aria-label="Move block 1 up"/);assert.match(html,/<legend>Article content<\/legend>/);assert.match(html,/Create article/);assert.match(html,/Create the article first, then upload files/);
});
