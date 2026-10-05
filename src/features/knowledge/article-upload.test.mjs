import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

function setup(result) {
  const calls=[];
  const bucket={upload:async()=>({error:null}),remove:async paths=>{calls.push(paths);return {error:null};}};
  const query={insert:values=>{calls.push(['insert',values]);return query;},select:()=>query,single:async()=>{if(result instanceof Error)throw result;return result;}};
  const harness=componentHarness('src/features/knowledge/article-editor.tsx','ArticleEditor',{
    organizationId:'org',article:{id:'article',content:[],related_article_ids:[],revision:1,title:'Title'},assets:[],related:[],
  },{'@/lib/supabase/client':{createClient:()=>({storage:{from:()=>bucket},from:()=>query})},'next/navigation':{useRouter:()=>({push(){},refresh(){}})},'@/app/app/help/actions':{saveArticle:async()=>({})}});
  return {harness,calls};
}
async function upload(h) {
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'photo.png',type:'image/png',size:10}],value:'photo.png'}});
  await new Promise(resolve=>setImmediate(resolve));h.render();
}
test('knowledge uploads preserve files after uncertain registration, including lost responses',async()=>{
  for(const result of [{error:{code:'',message:'fetch failed'},data:null},new Error('lost response'),{error:null,data:null},{error:{code:'40003'},data:null}]){
    const {harness:h,calls}=setup(result);
    try {await upload(h);assert.equal(calls.length,1);assert.match(h.find(n=>n.props.role==='status').props.children,/could not confirm/);assert.equal(h.all(n=>n.type==='a').length,0);}finally{h.close();}
  }
});
test('knowledge uploads clean up only explicit rejection and add confirmed assets to the list',async()=>{
  for(const saved of [false,true]) {
    const asset={id:'asset',content_type:'image/png',file_name:'photo.png'};
    const {harness:h,calls}=setup(saved?{data:asset,error:null}:{data:null,error:{code:'42501'}});
    try {await upload(h);assert.equal(calls.length,saved?1:2);assert.match(h.find(n=>n.props.role==='status').props.children,saved?/File added/:/Upload failed/);assert.equal(h.all(n=>n.type==='a').length,saved?1:0);}finally{h.close();}
  }
});
