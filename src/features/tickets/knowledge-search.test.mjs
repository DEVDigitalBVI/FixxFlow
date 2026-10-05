import assert from 'node:assert/strict';
import test from 'node:test';
import {parseArticleContent,safeArticleLink} from '../knowledge/content.ts';
test('article links allow HTTP(S) and reject scripts, data URLs, credentials, and relative redirects',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','//evil.test','https://user:password@example.test'])assert.equal(safeArticleLink(url),null);
 assert.equal(safeArticleLink('https://example.test/help'),'https://example.test/help');
});
test('structured content rejects unknown blocks, oversized documents, and images without alt text',()=>{
 assert.equal(parseArticleContent([{type:'html',text:'<script>bad</script>'}]),null);
 assert.equal(parseArticleContent([{type:'image',text:'',assetId:'10000000-0000-0000-0000-000000000001'}]),null);
 assert.equal(parseArticleContent(Array(101).fill({type:'paragraph',text:'test'})),null);
 assert.equal(parseArticleContent([{type:'paragraph',text:'a'.repeat(100000)}]),null);
 assert.deepEqual(parseArticleContent([{type:'paragraph',text:'**Hello**',html:'ignored'}]),[{type:'paragraph',text:'**Hello**'}]);
});
