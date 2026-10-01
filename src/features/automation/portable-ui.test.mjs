import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { definition, action, uuid } from '../../../tests/fixtures/automation.mjs';
const p=load('src/features/automation/portable.ts');
const mocks={'server-only':{},'next/navigation':{useRouter:()=>({replace(){},push(){}})},'@/app/app/administration/automations/actions':{}};
const source=definition({actions:[action('assign_team',{teamId:uuid(80)})]});
const pkg=p.exportPortablePackage(source,{[uuid(80)]:'Network Team'});
const select=async(h,text=JSON.stringify(pkg),size=text.length)=>{await h.find(n=>n.props.id==='automation-import-file').props.onChange({target:{files:[{size,text:async()=>text}]}});h.render();};

test('file selection validates, focuses review, leaves destinations unresolved and blocks incomplete draft',async()=>{
  const h=componentHarness('src/features/automation/import-automation.tsx','ImportAutomation',{},mocks);
  try{
    assert.equal(h.find(n=>n.props.id==='automation-import-file').props.type,'file');
    await select(h);assert.equal(h.focuses.at(-1),'import-review-heading');
    let row=h.find(n=>n.type.name==='MappingRow');assert.equal(row.props.value,'');
    h.find(n=>n.type==='button'&&n.props.children==='Review and test draft').props.onClick();h.render();
    assert.ok(h.find(n=>n.props.role==='alert'));assert.equal(h.focuses.at(-1),'import-error');
    row=h.find(n=>n.type.name==='MappingRow');assert.equal(row.props.showError,true);
    row.props.onChoices([{id:uuid(90),label:'Destination Network',active:true}]);row.props.onChange(uuid(90));h.render();
    h.find(n=>n.type==='button'&&n.props.children==='Review and test draft').props.onClick();h.render();
    const builder=h.find(n=>n.type.name==='AutomationBuilder');
    assert.equal(builder.props.imported,true);assert.equal(builder.props.initial,undefined);
    assert.equal(builder.props.draft.actions[0].configuration.teamId,uuid(90));assert.equal(builder.props.initialLabels[uuid(90)],'Destination Network');
    assert.equal(builder.props.focusOnMount,true);
    builder.props.onChooseTemplate();h.render();assert.equal(h.find(n=>n.type.name==='MappingRow').props.value,uuid(90));
  }finally{h.close();}
});

test('malformed file is recoverable; oversized files are rejected before reading',async()=>{
  const h=componentHarness('src/features/automation/import-automation.tsx','ImportAutomation',{},mocks);
  try{
    await select(h,'{');assert.equal(h.find(n=>n.props.id==='automation-import-file').props['aria-invalid'],true);
    let read=false;await h.find(n=>n.props.id==='automation-import-file').props.onChange({target:{files:[{size:p.portableLimits.bytes+1,text:async()=>{read=true;return '{}';}}]}});h.render();assert.equal(read,false);
    await select(h);assert.equal(h.find(n=>n.props.id==='automation-import-file').props['aria-invalid'],undefined);
  }finally{h.close();}
});

test('late file reads cannot overwrite the latest selection',async()=>{
  const h=componentHarness('src/features/automation/import-automation.tsx','ImportAutomation',{},mocks);
  try{
    let finish;const old=h.find(n=>n.props.id==='automation-import-file').props.onChange({target:{files:[{size:10,text:()=>new Promise(resolve=>{finish=resolve;})}]}});
    await select(h);finish('{');await old;h.render();assert.ok(h.find(n=>n.type.name==='MappingRow'));assert.equal(h.all(n=>n.props.role==='alert').length,0);
  }finally{h.close();}
});

test('unique suggested match stays unconfirmed until explicit keyboard-native confirmation',async()=>{
  const calls=[],choice={id:uuid(90),label:'Network Team',active:true};
  const h=componentHarness('src/features/automation/import-automation.tsx','MappingRow',{reference:pkg.references[0],value:'',onChange:id=>calls.push(id),onChoices:()=>{}},{...mocks,'./choice-client':{loadAutomationChoices:async()=>({rows:[choice],hasNext:false})}});
  try{
    await h.find(n=>n.type==='button'&&n.props.children==='Find a suggested match').props.onClick();h.render();
    assert.deepEqual(calls,[]);assert.match(h.find(n=>n.props.role==='status').props.children,/Suggested/);
    const confirm=h.find(n=>n.type==='button'&&n.props.children==='Confirm suggested match');assert.equal(confirm.props.type,'button');confirm.props.onClick();assert.deepEqual(calls,[uuid(90)]);
  }finally{h.close();}
});

test('mapping controls have explicit source-specific labels and associated errors',()=>{
  const {MappingRow}=load('src/features/automation/import-automation.tsx',mocks);
  const html=render(React.createElement(MappingRow,{reference:pkg.references[0],value:'',onChange(){},onChoices(){},showError:true}));
  assert.match(html,/Destination team for Network Team/);assert.match(html,/aria-invalid="true"/);assert.match(html,/aria-describedby="mapping-error-ref-1"/);
  assert.match(html,/Select a destination team before continuing/);assert.doesNotMatch(html,/<script/);
});

test('review escapes untrusted package text; summary uses human labels',()=>{
  const {automationSummary}=load('src/features/automation/summary.ts');
  const preview=p.portablePreview(pkg);assert.match(automationSummary(preview.definition,preview.labels),/Network Team/);assert.doesNotMatch(automationSummary(preview.definition,preview.labels),/00000000/);
  const {MappingRow}=load('src/features/automation/import-automation.tsx',mocks);
  const html=render(React.createElement(MappingRow,{reference:{...pkg.references[0],sourceLabel:'<script>alert(1)</script>'},value:'',onChange(){},onChoices(){}}));
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test('import builder uses normal disabled save, imported feedback, and existing draft dry run',async()=>{
  const calls=[],routes=[],draft=p.resolvePortableDraft(pkg,{'ref-1':uuid(90)}).definition;
  const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',{draft,imported:true},{...mocks,'next/navigation':{useRouter:()=>({replace:path=>routes.push(path)})},'@/app/app/administration/automations/actions':{saveAutomationDraft:async(...args)=>{calls.push(args);return{ok:true,value:{rule:{id:uuid(2),version:1,definition:draft,enabled:false}}};}}});
  try{
    h.find(n=>n.type==='button'&&n.props.children==='Test Automation').props.onClick();h.render();assert.deepEqual(h.find(n=>n.type.name==='DryRunPanel').props.definition,draft);
    const result=await h.find(n=>n.type.name==='ActionForm').props.action();
    assert.deepEqual(calls,[[null,null,draft]]);assert.match(result.success,/imported as disabled/);assert.match(routes[0],/saved=imported/);
  }finally{h.close();}
});

test('export failure is safe, announced and retryable',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>({ok:false});
  const h=componentHarness('src/features/automation/export-button.tsx','ExportAutomationButton',{id:uuid(2),name:'Test'});
  try{await h.find(n=>n.type==='button').props.onClick();h.render();assert.equal(h.find(n=>n.type==='button').props.disabled,false);assert.match(h.find(n=>n.props.role==='alert').props.children,/try again/);}finally{h.close();globalThis.fetch=previous;}
});
