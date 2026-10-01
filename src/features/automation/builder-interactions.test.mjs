import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
import {action,definition,group,rule,uuid} from '../../../tests/fixtures/automation.mjs';
const button=(h,text)=>h.find(node=>node.type==='button'&&node.props.children===text);
const actionsPath='@/app/app/administration/automations/actions';
const base={'server-only':{},'next/navigation':{useRouter:()=>({push(){},replace(){}})}};
function fixture(overrides={}){
 const calls=[];let response={ok:true,value:{rule:rule({enabled:false,version:2,definition:definition({conditions:group()})})}};
 const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',overrides,{...base,[actionsPath]:{saveAutomationDraft:async(...args)=>{calls.push(args);return response;}}});
 return{h,calls,setResponse:value=>{response=value;}};
}
test('add/remove conditions, context-sensitive operators and action order preserve semantic focus',()=>{
 const {h}=fixture();try{
   button(h,'+ Add condition').props.onClick();h.render();const field=h.find(n=>n.type==='select'&&n.props.id.startsWith('condition-'));assert.equal(h.focuses.at(-1),field.props.id);
   field.props.onChange({target:{value:'team_id'}});h.render();const comparison=h.find(n=>n.type==='select'&&n.props.id.startsWith('operator-'));
   comparison.props.onChange({target:{value:'is_empty'}});h.render();assert.equal(h.all(n=>typeof n.type==='function'&&n.type.name==='ValueControl').length,0);
   h.find(n=>n.type==='button'&&n.props['aria-label']==='Remove condition 1').props.onClick();h.render();assert.equal(h.focuses.at(-1),'add-condition');
   button(h,'+ Add action').props.onClick();h.render();button(h,'+ Add action').props.onClick();h.render();
   const before=h.all(n=>n.type==='select'&&n.props.id.startsWith('action-')).map(n=>n.props.id);
   const up=h.find(n=>n.props['aria-label']==='Move action 2 up');assert.equal(up.props.type,'button');assert.equal(up.props.disabled,false);up.props.onClick();h.render();
   assert.deepEqual(h.all(n=>n.type==='select'&&n.props.id.startsWith('action-')).map(n=>n.props.id),[before[1],before[0]]);assert.equal(h.focuses.at(-1),before[1]);
   assert.match(h.find(n=>n.props['aria-live']==='polite').props.children,/position 1/);
   h.find(n=>n.props['aria-label']==='Remove action 1').props.onClick();h.render();assert.equal(h.focuses.at(-1),'add-action');
   assert.equal(h.find(n=>n.props['aria-label']==='Move action 1 up').props.disabled,true);
 }finally{h.close();}
});
test('validation and concurrency failure keep the draft; save carries the loaded version without enabling',async()=>{
 const {h,calls,setResponse}=fixture({initial:{rule:rule({enabled:false,version:7,definition:definition({conditions:group()})}),archivedAt:null}});try{
   h.find(n=>n.props.id==='automation-name').props.onChange({target:{value:''}});h.render();
   let result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();h.render();assert.match(result.error,/highlighted/);assert.equal(calls.length,0);
   h.find(n=>n.props.id==='automation-name').props.onChange({target:{value:'My unsaved route'}});h.render();setResponse({ok:false,error:{code:'conflict',message:'Conflict'}});
   result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();h.render();assert.match(result.error,/draft is preserved/);assert.equal(h.find(n=>n.props.id==='automation-name').props.value,'My unsaved route');assert.equal(calls[0][1],7);
   setResponse({ok:true,value:{rule:rule({enabled:false,version:8,definition:definition({name:'My unsaved route',conditions:group()})})}});
   result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();h.render();assert.match(result.success,/enablement was not changed/);
 }finally{h.close();}
});
test('new save and test panel opening preserve an unsaved definition',async()=>{
 const {h,calls,setResponse}=fixture();try{
   h.find(n=>n.props.id==='automation-name').props.onChange({target:{value:'New draft'}});h.render();button(h,'+ Add action').props.onClick();h.render();
   const actionSelect=h.find(n=>n.type==='select'&&n.props.id.startsWith('action-'));actionSelect.props.onChange({target:{value:'set_priority'}});h.render();
   button(h,'Test Automation').props.onClick();h.render();const panel=h.find(n=>typeof n.type==='function'&&n.type.name==='DryRunPanel');assert.equal(panel.props.definition.name,'New draft');assert.equal(calls.length,0);
   setResponse({ok:true,value:{rule:rule({enabled:false,definition:definition({name:'New draft',conditions:group(),actions:[action()]})})}});
   const result=await h.find(n=>typeof n.type==='function'&&n.type.name==='ActionForm').props.action();assert.equal(calls[0][0],null);assert.match(result.success,/saved as disabled/);
 }finally{h.close();}
});
test('test panel sends the unsaved draft and simulated fields without save or execution',async()=>{
 const calls=[];const draft=definition({name:'Unsaved'});
 const h=componentHarness('src/features/automation/dry-run-panel.tsx','DryRunPanel',{definition:draft,labels:{},onChoices:()=>{}},{...base,[actionsPath]:{findAutomationEvents:async()=>({ok:true,value:{rows:[],hasNext:false}}),runAutomationTest:async input=>{calls.push(input);return{result:{ok:false,error:{message:'Sample validation'},sideEffectsPerformed:false,notice:'No changes were made.'},labels:{}};}}});
 try{
   h.find(n=>typeof n.type==='function'&&n.type.name==='ReferencePicker').props.onChange(uuid(18));h.render();h.find(n=>n.props.id==='test-context').props.onChange({target:{value:'simulated_transition'}});h.render();h.find(n=>n.props.id==='simulate-priority').props.onChange({target:{value:'critical'}});h.render();
   await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(calls[0].definition.kind,'draft');assert.equal(calls[0].definition.value.name,'Unsaved');assert.deepEqual(calls[0].source,{kind:'simulated_transition',after:{priority:'critical'}});assert.equal(h.focuses.at(-1),'Automation test result');
   assert.ok(h.all(n=>n.type==='strong'&&n.props.children==='No changes were made.').length);
 }finally{h.close();}
});
