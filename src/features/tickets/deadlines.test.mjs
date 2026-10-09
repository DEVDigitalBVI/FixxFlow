import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
const { parseDeadline, deadlineInputValue }=load('src/features/tickets/deadlines.ts');

test('manual deadline values round trip in BVI time across date boundaries and host timezones',()=>{
 const previous=process.env.TZ;
 try {
  for(const timezone of ['UTC','America/Los_Angeles','Asia/Tokyo']){
   process.env.TZ=timezone;
   for(const [input,expected] of [['2026-10-09T09:00','2026-10-09T13:00:00.000Z'],['2026-12-31T23:30','2027-01-01T03:30:00.000Z'],['2028-02-29T00:00','2028-02-29T04:00:00.000Z']]){
    assert.equal(parseDeadline(input),expected);assert.equal(deadlineInputValue(expected),input);
   }
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('empty deadlines clear and malformed or impossible dates are rejected',()=>{
 assert.equal(parseDeadline(''),null);assert.equal(deadlineInputValue(null),'');
 for(const invalid of ['tomorrow','2026-02-29T09:00','2026-04-31T09:00','2026-10-09T24:00','2026-10-09T09:60','0000-01-01T00:00','2026-10-09T09:00Z','2026-10-09T09:00:00'])assert.equal(parseDeadline(invalid),undefined,invalid);
});
