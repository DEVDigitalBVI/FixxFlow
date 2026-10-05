import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../tests/helpers/load-module.mjs';
const { reportServerError } = load('src/lib/server-errors.ts');
test('diagnostics correlate safe operation codes without recording arbitrary error data',()=>{
 const old=console.error,events=[];console.error=value=>events.push(JSON.parse(value));
 try {
  const reference=reportServerError('ticket.save',{code:'23503',message:'SECRET message',details:'user@example.test',token:'private-token',stack:'private-stack'});
  assert.match(reference,/^[0-9a-f-]{36}$/);
  assert.deepEqual(events[0],{event:'application.failure',operation:'ticket.save',code:'23503',correlationId:reference});
  reportServerError('notification.send',{code:'secret-token'},reference);
  assert.equal(events[1].code,'UNEXPECTED');assert.equal(events[1].correlationId,reference);
 } finally {console.error=old;}
});
