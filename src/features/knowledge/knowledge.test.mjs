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

test('published collection parses, covers all topics, and has valid related guides',()=>{
 const collection=JSON.parse(fs.readFileSync('content/knowledge/general-it.json','utf8'));
 const {parseArticleContent,knowledgeCategories}=load('src/features/knowledge/content.ts');
 const keys=new Set(collection.articles.map(a=>a.key));
 assert.equal(keys.size,collection.articles.length);
 assert.deepEqual(new Set(collection.articles.map(a=>a.category)),new Set(knowledgeCategories));
 for(const article of collection.articles){
  assert.ok(article.title.length<=180 && article.summary.length>0 && article.summary.length<=500);
  assert.ok(parseArticleContent(article.content),article.key);
  assert.ok(article.content.some(b=>b.type==='heading' && b.text==='Check the result'));
  assert.ok(article.content.some(b=>b.type==='heading' && b.text==='When to contact IT'));
  assert.ok(article.related.length<=8 && article.related.every(key=>keys.has(key) && key!==article.key));
  const html=renderToStaticMarkup(React.createElement(ArticleContent,{content:article.content,showContents:true}));
  assert.doesNotMatch(html,/could not be displayed|<script>/);
 }
});
test('article contents links resolve to unique focusable headings, including repeated titles',()=>{
 const html=renderToStaticMarkup(React.createElement(ArticleContent,{showContents:true,content:[{type:'heading',text:'Check'},{type:'paragraph',text:'Details'},{type:'heading',text:'Check'}]}));
 assert.match(html,/aria-label="On this page"/);
 for(const id of ['article-section-0','article-section-2']){
  assert.match(html,new RegExp(`href="#${id}"`));
  assert.match(html,new RegExp(`id="${id}" tabindex="-1"`));
 }
});
test('knowledge import is explicitly scoped and uses stable organization-specific article IDs',async()=>{
 const {buildImport,articleId}=await import('../../../scripts/knowledge-import.mjs');
 const collection=JSON.parse(fs.readFileSync('content/knowledge/general-it.json','utf8'));
 const org='20000000-0000-0000-0000-000000000001';
 assert.equal(articleId(org,'wifi'),articleId(org,'wifi'));
 assert.notEqual(articleId(org,'wifi'),articleId('20000000-0000-0000-0000-000000000002','wifi'));
 assert.throws(()=>buildImport(collection,org,"bad';slug"));
 assert.throws(()=>buildImport(collection,'',''));
 const sql=buildImport(collection,org,'my-org');
 assert.match(sql,/Organization identity does not match/);
 assert.match(sql,/knowledge_import_created/);
 assert.doesNotMatch(sql,/delete from|on conflict.*do update/i);
});

async function renderHelp({role='end_user',filters={},data=[],error=null}={}) {
 const query={select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data,error})};
 const {default:Page}=load('src/app/app/help/page.tsx',{
  'next/link':{default:props=>React.createElement('a',props)},
  '@/features/product-analytics/usage-event':{UsageEvent:()=>null},
  '@/features/knowledge/content':load('src/features/knowledge/content.ts'),
  '@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'org',usageSharing:false})},
  '@/lib/supabase/server':{createClient:async()=>({from:()=>query,rpc:()=>query})},
 });
 return renderToStaticMarkup(await Page({searchParams:Promise.resolve(filters)}));
}
test('help browsing exposes labeled topic links and a useful empty state to employees',async()=>{
 const html=await renderHelp();
 assert.match(html,/aria-label="Browse help topics"/);
 assert.match(html,/href="\/app\/help\?category=Security"/);
 assert.match(html,/No published guides yet/);
 assert.match(html,/Submit a request/);
 assert.doesNotMatch(html,/New article|All, including drafts/);
});
test('filtered results, empty searches, and failures preserve recovery paths',async()=>{
 const filtered=await renderHelp({filters:{q:'printer'}});
 assert.doesNotMatch(filtered,/Browse help topics/);
 assert.match(filtered,/No articles found/);
 const error=await renderHelp({error:{message:'offline'}});
 assert.match(error,/role="alert"/);
 assert.match(error,/Try again/);
 assert.doesNotMatch(error,/No published guides yet/);
 const staff=await renderHelp({role:'administrator',filters:{view:'all'}});
 assert.match(staff,/category=Security&amp;view=all/);
 assert.match(staff,/New article/);
});
