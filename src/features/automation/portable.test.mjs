import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition, action, condition, group, uuid, validateDefinition, registry } from '../../../tests/fixtures/automation.mjs';
const p = load('src/features/automation/portable.ts');
const packageFor = (def = definition()) => p.exportPortablePackage(def, {}, '2026-10-01T12:00:00Z');
const parse = value => p.parsePortablePackage(JSON.stringify(value));
const source = definition({ conditions: group(condition('category_id', 'equals', uuid(80)), condition('team_id', 'in', [uuid(81), uuid(82)], 'c2')),
  actions: [action('assign_team', { teamId: uuid(81) }), action('assign_technician', { technicianId: uuid(83) }, 1)] });

test('export projects configuration only; all source identity becomes typed package-local references', () => {
  assert.throws(() => p.exportPortablePackage({ ...source, organizationId: uuid(99) }, {}), /valid/);
  const pkg = p.exportPortablePackage(source, { [uuid(80)]: 'Network', [uuid(81)]: 'Network Team', [uuid(82)]: 'Support', [uuid(83)]: 'David' });
  assert.deepEqual(Object.keys(pkg), ['format', 'version', 'exportedAt', 'references', 'rules']);
  assert.equal(pkg.references.length, 4);
  assert.deepEqual(pkg.rules[0].actions[0].configuration, { teamId: { reference: 'ref-2' } });
  assert.deepEqual(pkg.references.map(r => r.kind), ['category', 'team', 'team', 'technician']);
  for (const id of [80,81,82,83]) assert.ok(!JSON.stringify(pkg).includes(uuid(id)));
  assert.doesNotMatch(JSON.stringify(pkg), /organizationId|createdBy|correlation|execution|lease|enabled|schemaVersion/);
  assert.match(p.portablePreview(pkg).labels['00000000-0000-4000-8000-000000000002'], /Network Team/);
  assert.deepEqual(source.actions.map(a => a.id), ['action-0','action-1']);
});

test('round trip resolves every reference to destination IDs and preserves ordered behavior', () => {
  const pkg = packageFor(source), mapping = Object.fromEntries(pkg.references.map((r, i) => [r.key, uuid(100 + i)]));
  const result = p.resolvePortableDraft(parse(pkg), mapping);
  assert.equal(result.enabled, false);
  assert.equal(validateDefinition(result.definition, registry).valid, true);
  assert.equal(result.definition.conditions.children[0].value, uuid(100));
  assert.deepEqual(result.definition.conditions.children[1].value, [uuid(101), uuid(102)]);
  assert.equal(result.definition.actions[0].configuration.teamId, uuid(101));
  assert.deepEqual(result.definition.actions.map(a => a.position), [0,1]);
  assert.throws(() => p.resolvePortableDraft(pkg, {}), /Select a destination category/);
  assert.throws(() => p.resolvePortableDraft(pkg, { 'ref-1': 'Network' }), /Select a destination/);
});

for (const [type, configuration] of [
  ['ticket.unassigned_duration_reached',{durationMinutes:30}], ['ticket.waiting_on_user_duration_reached',{durationMinutes:4320}],
  ['ticket.open_duration_reached',{durationMinutes:1440}], ['ticket.sla_approaching',{durationMinutes:30,objective:'resolution'}], ['ticket.sla_breached',{objective:'response'}],
]) test(`temporal portability: ${type} preserves canonical configuration only`, () => {
  const pkg = packageFor(definition({trigger:{type,configuration}}));
  assert.deepEqual(p.resolvePortableDraft(parse(pkg), {}).definition.trigger, {type,configuration});
  assert.doesNotMatch(JSON.stringify(pkg), /episode|cursor|due_at|occurrence|deadline/);
});

test('every currently supported reference field is encoded, including lists and requester', () => {
  for (const field of ['category_id','subcategory_id','assigned_technician_id','team_id','requester_id','requester_department_id','location_id']) {
    for (const op of ['equals','not_equals','in','not_in','is_empty','is_not_empty']) {
      // requester is non-nullable, so empty operators are not part of its contract.
      if(field==='requester_id'&&op.startsWith('is_'))continue;
      const pkg = packageFor(definition({conditions:group(condition(field,op,['in','not_in'].includes(op)?[uuid(80)]:uuid(80)))}));
      assert.ok(!JSON.stringify(pkg).includes(uuid(80)));
      const mapping=Object.fromEntries(pkg.references.map(ref=>[ref.key,uuid(90)]));
      assert.equal(validateDefinition(p.resolvePortableDraft(pkg,mapping).definition,registry).valid,true);
    }
  }
});

for (const [name, change, message] of [
  ['missing format', p => {delete p.format;}, /FixxFlow/], ['wrong format', p => {p.format='other';}, /FixxFlow/],
  ['missing version', p => {delete p.version;}, /version/], ['future version', p => {p.version=2;}, /newer/],
  ['old unsupported version', p => {p.version=0;}, /version/], ['malformed version', p => {p.version='1';}, /version/],
  ['unknown root', p => {p.organizationId=uuid(9);}, /Unrecognized/], ['runtime data', p => {p.rules[0].executions=[];}, /Runtime/],
  ['automatic enablement', p => {p.rules[0].enabled=true;}, /Unrecognized/], ['bulk rules', p => {p.rules.push(p.rules[0]);}, /one automation/],
  ['unknown trigger', p => {p.rules[0].trigger.type='ticket.future';}, /unsupported trigger/],
  ['unknown action', p => {p.rules[0].actions[0].type='create_task';}, /unsupported action/],
  ['unknown field', p => {p.rules[0].conditions.items[0].field='secret';}, /unsupported condition/],
  ['OR', p => {p.rules[0].conditions.operator='or';}, /all of which/],
  ['unknown secret setting', p => {p.rules[0].actions[0].configuration.token='secret';}, /Unrecognized action/],
  ['invalid value', p => {p.rules[0].conditions.items[0].value='urgent';}, /correct type/],
  ['too many actions', p => {p.rules[0].actions=Array(21).fill(p.rules[0].actions[0]);}, /20 actions/],
  ['too many conditions', p => {p.rules[0].conditions.items=Array(51).fill(p.rules[0].conditions.items[0]);}, /50 conditions/],
  ['invalid export time', p => {p.exportedAt='yesterday';}, /date/],
]) test(`import rejects ${name}`, () => { const pkg=packageFor();change(pkg);assert.throws(()=>parse(pkg),message); });

test('malformed, oversized, pathological nesting and prototype fields fail before use', () => {
  for (const text of ['{','null','[]']) assert.throws(()=>p.parsePortablePackage(text));
  assert.throws(()=>p.parsePortablePackage(' '.repeat(p.portableLimits.bytes+1)),/512 KB/);
  assert.throws(()=>p.parsePortablePackage('['.repeat(13)+'0'+']'.repeat(13)),/deeply/);
  assert.throws(()=>p.parsePortablePackage('{"__proto__":{"polluted":true}}'),/limits/);
  assert.equal({}.polluted, undefined);
});

test('missing/wrong reference kinds, source UUIDs, unused and duplicate references are rejected', () => {
  for (const mutate of [
    pkg=>{pkg.references[0].kind='technician';}, pkg=>{pkg.references[0].key='ref-99';},
    pkg=>{pkg.references[0].sourceId=uuid(80);},pkg=>{pkg.references[0].sourceLabel=uuid(80);},
    pkg=>{pkg.references.push({...pkg.references[0]});},
    pkg=>{pkg.references.push({key:'ref-99',kind:'team',sourceLabel:'Unused'});},
    pkg=>{pkg.rules[0].conditions.items[0].value=uuid(80);},
    pkg=>{pkg.rules[0].actions[0].configuration.teamId={reference:'ref-1'};},
  ]) {const pkg=packageFor(source);mutate(pkg);assert.throws(()=>parse(pkg));}
});

test('executable-looking text remains inert note text, not interpreted code or HTML', () => {
  const body='<script>globalThis.portabilityExecuted=true</script> ${process.exit()} SELECT secret; {{token}}';
  const pkg=packageFor(definition({actions:[action('add_internal_note',{body})]}));
  assert.equal(p.resolvePortableDraft(parse(pkg),{}).definition.actions[0].configuration.body,body);
  assert.equal(globalThis.portabilityExecuted,undefined);
});

test('suggestions are unique, active, normalized, complete results and never confirmed by resolution', () => {
  const ref={key:'ref-1',kind:'team',sourceLabel:' Network Team '};
  const row={id:uuid(90),label:'network team',active:true};
  assert.deepEqual(p.suggestPortableReference(ref,[row],false),row);
  for(const [rows,hasNext] of [[[row],true],[[row,{...row,id:uuid(91)}],false],[[{...row,active:false}],false],[[],false]]) assert.equal(p.suggestPortableReference(ref,rows,hasNext),null);
  assert.throws(()=>p.resolvePortableDraft(packageFor(source),{}),/Select a destination/);
});

test('filenames cannot contain traversal, control characters, quotes or source identifiers', () => {
  assert.equal(p.portableFilename('Critical Network Routing'),'critical-network-routing.fixxflow.json');
  assert.equal(p.portableFilename('../../\r\n"'), 'automation.fixxflow.json');
  assert.match(p.portableFilename('Équipe réseau'),/^equipe-reseau/);
  assert.ok(p.portableFilename('A'.repeat(1000)).length<=94);
});

test('documented sanitized package parses and requires destination review', () => {
  const example=fs.readFileSync('docs/automation-portability.md','utf8').match(/```json\n([\s\S]*?)\n```/)[1];
  const pkg=p.parsePortablePackage(example);
  assert.equal(pkg.references[0].kind,'team');assert.doesNotMatch(example,/[0-9a-f]{8}-[0-9a-f]{4}/i);
  assert.throws(()=>p.resolvePortableDraft(pkg,{}),/Select a destination team/);
});

test('reference count and label/string limits cannot bypass package validation', () => {
  const pkg=packageFor(source);
  pkg.references=Array.from({length:201},(_,i)=>({key:`ref-${i+1}`,kind:'team',sourceLabel:'Team'}));
  assert.throws(()=>parse(pkg),/200/);
  const badLabel=packageFor(source);badLabel.references[0].sourceLabel='x'.repeat(181);assert.throws(()=>parse(badLabel),/display name/);
  const badName=packageFor();badName.rules[0].name='x'.repeat(121);assert.throws(()=>parse(badName),/120/);
  const badNote=packageFor();badNote.rules[0].actions=[{type:'add_internal_note',configuration:{body:'x'.repeat(20001)}}];assert.throws(()=>parse(badNote),/valid values/);
});
