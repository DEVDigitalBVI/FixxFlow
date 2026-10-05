import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const choice = (id,label=id) => ({id,label,active:true,parent_id:null});

test('lookup retains selected values across pages/search, cancels stale requests, and recovers from failure', async () => {
 const old = globalThis.fetch; const calls=[]; let fail=false;
 globalThis.fetch = async (url,options) => {
  const params = new URL(url,'https://fixture.test').searchParams; calls.push({params,options});
  if(fail)return Response.json({}, {status:503});
  return Response.json({rows:[choice(params.get('cursor')?'second':'first')],selected:choice('chosen'),next:params.get('cursor')?null:'next-page'});
 };
 const ui = componentHarness('src/features/lookups/lookup-select.tsx','LookupSelect',{resource:'people',name:'requesterId',label:'Requester',defaultValue:'chosen'});
 try {
  await pause(10);ui.render();
  assert.equal(ui.find(n=>n.type==='select').props.value,'chosen');
  assert.ok(ui.all(n=>n.type==='option').some(n=>n.props.value==='chosen'));
  ui.find(n=>n.type==='button'&&n.props.children==='More choices').props.onClick();ui.render();await pause(10);ui.render();
  assert.equal(calls.at(-1).params.get('cursor'),'next-page');
  assert.equal(calls.at(-1).params.get('selected'),'chosen');
  assert.equal(ui.find(n=>n.type==='select').props.value,'chosen');
  const search=ui.find(n=>n.type==='input'&&n.props.type==='search');
  search.props.onChange({target:{value:'new'},stopPropagation(){}});ui.render();
  search.props.onChange({target:{value:'newest'},stopPropagation(){}});ui.render();await pause(330);ui.render();
  assert.equal(calls.at(-1).params.get('cursor'),'');assert.equal(calls.at(-1).params.get('q'),'newest');
  assert.ok(!calls.some(call=>call.params.get('q')==='new'));
  fail=true;
  ui.find(n=>n.type==='button'&&n.props.children==='More choices').props.onClick();ui.render();await pause(330);ui.render();
  assert.equal(ui.find(n=>n.type==='select').props.value,'chosen');
  assert.equal(ui.find(n=>n.props.name==='lookupLoadError').props.value,'true');
  assert.match(ui.find(n=>n.props.role==='status').props.children,/preserved/);
  fail=false;ui.find(n=>n.type==='button'&&n.props.children==='Try again').props.onClick();ui.render();await pause(330);ui.render();
  assert.equal(ui.all(n=>n.props.name==='lookupLoadError').length,0);
 } finally {ui.close();globalThis.fetch=old;}
 assert.ok(calls.every(call=>call.options.cache==='no-store'&&call.options.redirect==='error'));
});
