import assert from 'node:assert/strict';
import test from 'node:test';
import { searchArticles } from '../knowledge/articles.ts';
test('knowledge search matches all words across title and body without requiring a literal phrase',()=>{
 assert.equal(searchArticles('PASSWORD EMAIL').length,1);
 assert.equal(searchArticles('VPN error 809').length,0);
 assert.equal(searchArticles('').length,4);
});
