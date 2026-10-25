import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';

test('audience choice and revision remain with a failed draft across refreshes',async()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>{fn();return 0;};
 const props={organizationId:'org',article:{id:'article',title:'Draft',content:[{type:'paragraph',text:'Steps'}],audience:'it_only',related_article_ids:[],revision:2},assets:[],related:[]};
 const h=componentHarness('src/features/knowledge/article-editor.tsx','ArticleEditor',props,{'next/navigation':{useRouter:()=>({push(){},refresh(){}})},'@/lib/supabase/client':{createClient:()=>({})},'@/app/app/help/actions':{saveArticle:async()=>({error:'Please retry'})}});
 try{
  const control=h.find(n=>n.props.name==='audience');assert.equal(control.props.required,true);assert.equal(control.props.value,'it_only');
  control.props.onChange({target:{value:'employees'}});h.render();
  await h.find(n=>n.type==='form').props.action(new FormData());h.render();
  assert.equal(h.find(n=>n.props.name==='audience').props.value,'employees');
  props.article={...props.article,revision:3,audience:'it_only'};h.render();
  assert.equal(h.find(n=>n.props.name==='audience').props.value,'employees');
  assert.equal(h.find(n=>n.props.name==='revision').props.value,2);
 }finally{h.close();globalThis.requestAnimationFrame=previous;}
});
