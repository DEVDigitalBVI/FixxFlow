import { load } from '../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const {normalizeSearch,SEARCH_LIMIT}=load('src/lib/search.ts');
test('search normalizes whitespace, bounds input and rejects repeated parameters',()=>{
 assert.equal(normalizeSearch('  HP\t12345\n850  '),'HP 12345 850');
 assert.equal(normalizeSearch('a'.repeat(1000)).length,SEARCH_LIMIT);
 for(const input of [undefined,[],['one','two'],' \n\t '])assert.equal(normalizeSearch(input),'');
});
test('search preserves literal identifier and name punctuation',()=>{
 for(const query of ["O'Neil",'12345','SN_%*\\123','user+support@example.test','#1042','printer, east (2)'])assert.equal(normalizeSearch(query),query);
});
