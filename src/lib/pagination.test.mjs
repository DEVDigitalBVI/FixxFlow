import assert from 'node:assert/strict';
import test from 'node:test';
import { pageNumber } from './pagination.ts';

test('pagination rejects invalid offsets and caps valid page numbers', () => {
  for (const value of [undefined, '', 'NaN', 'Infinity', '0', '-9', '1.5', '2abc', '9007199254740992', ['2', '3'], '1e2', ' 2 ']) {
    assert.equal(pageNumber(value), 1);
  }
  assert.equal(pageNumber('2'), 2);
  assert.equal(pageNumber('9999999'), 100000);
});

test('screens retain their page ceilings', () => { assert.equal(pageNumber('20000', 10000), 10000); assert.equal(pageNumber('20000', 999999), 20000); });
