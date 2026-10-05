import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { definition, action, condition, group, rule, uuid } from '../../../tests/fixtures/automation.mjs';
const { automationTemplates, templateDraft } = load('src/features/automation/templates.ts');
const { validateDefinition } = load('src/features/automation/validation.ts');
const { persistenceRegistry } = load('src/features/automation/persistence-contract.ts');
const { automationSummary } = load('src/features/automation/summary.ts');
const { presentValidationIssue } = load('src/features/automation/validation-presentation.ts');
const actionsPath = '@/app/app/administration/automations/actions';
const mocks = { 'server-only': {}, 'next/navigation': { useRouter: () => ({ replace() {}, push() {} }) }, 'next/link': { default: props => React.createElement('a', props) }, [actionsPath]: {} };
const complete = draft => ({ ...draft,
  conditions: { ...draft.conditions, children: draft.conditions.children.map(c => c.value === '' ? { ...c, value: uuid(20) } : c) },
  actions: draft.actions.map(a => ({ ...a, configuration: Object.fromEntries(Object.entries(a.configuration).map(([key, value]) => [key, value !== '' ? value : key === 'body' ? 'Review the triage checklist.' : key === 'priority' ? 'high' : uuid(21)])) })),
});

test('built-in catalog has unique stable IDs and only existing engine capabilities', () => {
  assert.equal(new Set(automationTemplates.map(t => t.id)).size, automationTemplates.length);
  assert.equal(automationTemplates.length, 6);
  for (const t of automationTemplates) {
    assert.ok(t.useCase && t.guidance && t.category);
    assert.equal(t.definition.schemaVersion, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(t.definition)) <= 262144);
    assert.ok(persistenceRegistry.trigger(t.definition.trigger.type));
    for (const a of t.definition.actions) assert.ok(persistenceRegistry.action(a.type));
  }
  assert.throws(() => templateDraft('unknown'), /available/);
});
for (const template of automationTemplates) test(`${template.name}: completed draft fits Stage 12 structural ceilings without guessed references`, () => {
  const generated = templateDraft(template.id);
  assert.equal(generated.enabled, false);
  for (const c of generated.definition.conditions.children) {
    const field = persistenceRegistry.field('ticket', c.field);
    if (field.value.kind === 'reference') assert.equal(c.value, '');
  }
  for (const a of generated.definition.actions) for (const [key, spec] of Object.entries(persistenceRegistry.action(a.type).configuration)) {
    if (spec.value.kind === 'reference') assert.equal(a.configuration[key], '');
  }
  const initial = validateDefinition(generated.definition, persistenceRegistry);
  if (template.id !== 'requester-notification') {
    assert.equal(initial.valid, false);
    assert.ok(initial.issues.every(i => ['invalid_value','invalid_configuration'].includes(i.code)));
  } else {
    assert.equal(initial.valid, true);
    assert.deepEqual(generated.definition.actions[0].configuration, { recipient: 'requester', template: 'ticket_update' });
  }
  const result = validateDefinition(complete(generated.definition), persistenceRegistry);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.value.actions.map(a => a.position), result.value.actions.map((_, i) => i));
  assert.equal(Object.hasOwn(result.value, 'templateId'), false);
  generated.definition.actions[0].configuration.changed = true;
  assert.equal(Object.hasOwn(templateDraft(template.id).definition.actions[0].configuration, 'changed'), false);
});

test('gallery uses keyboard-native controls; selection and scratch open ordinary disabled drafts without server calls', () => {
  const h = componentHarness('src/features/automation/create-automation.tsx', 'CreateAutomation', {}, mocks);
  try {
    assert.equal(h.all(n => n.type === 'article').length, 6);
    h.find(n => n.props.id === 'template-critical-ticket-assignment').props.onClick(); h.render();
    let builder = h.find(n => typeof n.type === 'function' && n.type.name === 'AutomationBuilder');
    assert.equal(builder.props.draft.name, 'Critical Ticket Assignment');
    assert.equal(builder.props.draft.actions[0].configuration.teamId, '');
    assert.equal(builder.props.focusOnMount, true);
    builder.props.onChooseTemplate(); h.render();
    assert.equal(h.focuses.at(-1), 'template-critical-ticket-assignment');
    const scratch = h.find(n => n.props.id === 'template-scratch'); assert.equal(scratch.type, 'button'); assert.equal(scratch.props.type, 'button');
    scratch.props.onClick(); h.render();
    builder = h.find(n => typeof n.type === 'function' && n.type.name === 'AutomationBuilder');
    assert.equal(builder.props.draft.name, ''); assert.deepEqual(builder.props.draft.actions, []);
    assert.equal(builder.props.initial, undefined);
  } finally { h.close(); }
});

test('gallery preview explains customization and keeps missing choices visible without IDs or note bodies', () => {
  const { CreateAutomation } = load('src/features/automation/create-automation.tsx', mocks);
  const html = render(React.createElement(CreateAutomation));
  for (const text of ['Start from scratch','Popular templates','Customize every condition','Select team','Select category','Select priority']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /ticket\.created|teamId|category_id|Notify IT Manager/);
  assert.match(html, /aria-label="Use Critical Ticket Assignment template"/);
});

test('summaries follow structured conditions and configured action positions, update with edits and hide reference IDs', () => {
  const input = definition({ conditions: group(condition('priority','equals','critical'), { ...condition('category_id','equals',uuid(4)), id:'category' }), actions: [action('set_priority',{priority:'high'},1),action('assign_team',{teamId:uuid(5)},0)] });
  const text = automationSummary(input,{[uuid(4)]:'Network',[uuid(5)]:'Network Team'});
  assert.match(text,/When a ticket is created, if Priority equals Critical and Category equals Network/);
  assert.ok(text.indexOf('Network Team') < text.indexOf('Set priority'));
  assert.doesNotMatch(text, /00000000/);
  assert.notEqual(text, automationSummary({...input,trigger:{type:'ticket.status_changed',configuration:{}}}));
  assert.match(automationSummary({...input,trigger:{type:'ticket.status_changed',configuration:{}}}),/ticket’s status changes/);
  assert.notEqual(text,automationSummary({...input,conditions:group(condition('priority','equals','low'))}));
  assert.doesNotMatch(automationSummary(definition({actions:[action('add_internal_note',{body:'Private note content'})]})),/Private note content/);
  assert.match(automationSummary(templateDraft('critical-ticket-assignment').definition),/Select team/);
});

test('friendly validation targets the exact section and preserves draft values; summary links move focus', async () => {
  const calls=[];
  const draft=templateDraft('category-based-routing').definition;
  const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',{draft,template:automationTemplates[1],focusOnMount:true},{...mocks,[actionsPath]:{saveAutomationDraft:async()=>{calls.push(true);}}});
  try {
    assert.equal(h.focuses.at(-1),'automation-name');
    assert.ok(h.all(n=>n.type==='span'&&n.props.children==='Needs setup').length===2);
    const result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();h.render();
    assert.equal(result.error,undefined);assert.equal(h.focuses.at(-1),'automation-validation-summary');assert.equal(calls.length,0);
    assert.equal(h.find(n=>n.props.id==='automation-name').props.value,'Category Based Routing');
    const link=h.find(n=>n.type==='a'&&n.props.href==='#action-section-first-action');
    assert.equal(link.props.children,'Action 1: Select a team before saving this action.');
    link.props.onClick();assert.equal(h.focuses.at(-1),'action-section-first-action');
    const selection=h.all(n=>typeof n.type==='function'&&n.type.name==='ValueControl').find(n=>n.props.label==='Team');
    assert.equal(selection.props.invalid,true);assert.equal(selection.props.describedBy,'action-error-first-action');
    selection.props.onChange(uuid(9));h.render();
    assert.equal(h.all(n=>typeof n.type==='function'&&n.type.name==='ValueControl').find(n=>n.props.label==='Team').props.value,uuid(9));
  } finally {h.close();}
});

test('template drafts save through the existing flow without enabling and preserve a clear post-save notice', async () => {
  const draft=complete(templateDraft('technician-assignment').definition),calls=[],paths=[];
  const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',{draft},{...mocks,'next/navigation':{useRouter:()=>({replace:path=>paths.push(path)})},[actionsPath]:{saveAutomationDraft:async(...args)=>{calls.push(args);return{ok:true,value:{rule:rule({enabled:false,definition:draft})}};}}});
  try {
    const result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();
    assert.equal(calls[0][0],null);assert.equal(calls[0][1],null);assert.deepEqual(calls[0][2],draft);
    assert.match(result.success,/will not run until enabled/);assert.match(paths[0],/\?saved=disabled$/);
  } finally {h.close();}
});

test('leaving a changed draft requires confirmation and preserves it when cancelled',()=>{
  let left=0;const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',{draft:templateDraft('critical-ticket-assignment').definition,onChooseTemplate:()=>left++},mocks);
  try {h.find(n=>n.props.id==='automation-name').props.onChange({target:{value:'Keep my changes'}});h.render();globalThis.window.confirm=()=>false;h.find(n=>n.type==='button'&&n.props.children==='← Choose another starting point').props.onClick();assert.equal(left,0);assert.equal(h.find(n=>n.props.id==='automation-name').props.value,'Keep my changes');}finally{h.close();}
});

test('enable confirmation includes saved definition, trigger, version and processing-OFF explanation; archive is not deletion',()=>{
  const {RuleActions}=load('src/features/automation/rule-actions.tsx',{...mocks,'@/components/ui/action-form':{ActionForm:({children})=>React.createElement('form',null,children)},'@/components/ui/submit-button':{SubmitButton:({children})=>React.createElement('button',null,children)}});
  const props={id:uuid(2),name:'Critical routing',version:4,enabled:false,definition:complete(templateDraft('critical-ticket-assignment').definition),processingActive:false};
  const html=render(React.createElement(RuleActions,props));
  for(const text of ['Enable “Critical routing”','Ticket created','Version 4','When a ticket is created','Future eligible events','will not execute until processing is activated','Historical versions and execution history are retained'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/permanent|delete/i);
  const active=render(React.createElement(RuleActions,{...props,processingActive:true}));assert.doesNotMatch(active,/processing is currently disabled/);
  const list=render(React.createElement(RuleActions,{...props,definition:undefined}));assert.match(list,/Review and enable/);assert.doesNotMatch(list,/Enable rule<\/button>/);
});

test('all invalid action configurations receive actionable labels rather than schema paths',()=>{
  for(const t of automationTemplates){
    const d=templateDraft(t.id).definition;
    const issues=validateDefinition(d,persistenceRegistry);
    if(!issues.valid)for(const issue of issues.issues){const text=presentValidationIssue(d,issue);assert.ok(text.target);assert.doesNotMatch(text.message,/configuration|\.children|zero-based|identifiers/);}
  }
});

test('dry-run warnings preserve simulation and historical distinction without claiming runtime success',()=>{
  const {DryRunResultView}=load('src/features/automation/dry-run-panel.tsx',mocks);
  const value={context:{ticketNumber:1842,evaluatedRevision:1,currentRevision:3,source:'retained_event',differsFromCurrent:true},trigger:{compatible:true,explanation:'Compatible.'},conditions:[],actions:[],currentReferencesValid:true,wouldProceed:false,warnings:['This evaluates a definition, not enablement, backlog eligibility, leases or runtime success.','Current ticket state differs from the retained event.']};
  const html=render(React.createElement(DryRunResultView,{result:value,labels:{}}));
  for(const text of ['Retained historical event','ticket has changed','Proposed actions','Warnings','success is not guaranteed','does not allow an old event to run again'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/leases|backlog/);
});

test('processing-state presentation stays administrator-gated and cannot turn processing on',async()=>{
  const previous=process.env.AUTOMATION_PROCESSING_ENABLED;delete process.env.AUTOMATION_PROCESSING_ENABLED;
  try {
    const service=load('src/features/automation/ui-service.ts',{'server-only':{},'next/navigation':{notFound(){throw Error('DENIED');}},'@/lib/auth/viewer':{requireViewer:async()=>({role:'technician',status:'active'})},'@/lib/supabase/server':{createClient(){throw Error('unexpected client');}}});
    await assert.rejects(service.automationProcessingActive(),/DENIED/);
    const admin=load('src/features/automation/ui-service.ts',{'server-only':{},'@/lib/auth/viewer':{requireViewer:async()=>({role:'administrator',status:'active'})},'@/lib/supabase/server':{createClient(){throw Error('unexpected client');}}});
    assert.equal(await admin.automationProcessingActive(),false);
  } finally {if(previous===undefined)delete process.env.AUTOMATION_PROCESSING_ENABLED;else process.env.AUTOMATION_PROCESSING_ENABLED=previous;}
});

test('template layout stacks and error destinations retain visible focus without new motion',()=>{
  const css=fs.readFileSync('src/app/globals.css','utf8');
  assert.match(css,/automation-template-grid[^}]*minmax\(min\(100%,320px\),1fr\)/);
  assert.match(css,/@media \(max-width: 767px\)[\s\S]*automation-template-grid[^}]*minmax\(0,1fr\)/);
  assert.match(css,/automation-page \[tabindex="-1"\]:focus[^}]*var\(--color-focus\)/);
  assert.equal(load('src/features/automation/ui-model.ts').executionDuration(null,'failed'),'Not recorded');
});
