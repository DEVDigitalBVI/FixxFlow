import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
const model=load('src/features/inventory/model.ts');
test('whole stock quantities reject fractions, zero, signs and overflow; corrections allow negative integers',()=>{
 for(const value of ['',null,'0','-1','1.5','1e3','+1','2147483648'])assert.equal(model.quantity(value),null);
 assert.equal(model.quantity('12'),12);assert.equal(model.quantity('-3',true),-3);
 assert.equal(model.quantity('0',true),null);
 assert.equal(new Set(Object.values(model.inventoryStates).map(s=>s.label)).size,6);
});
const item={id:'item',name:'Toner',kind:'consumable',department_name:'Engineering',stock:8,reserved:3};
const request={id:'request',item_id:'item',quantity:2,destination:'Engineering office',recipient_id:null,context:{item:'Toner'}};
const shared={
 '@/components/ui/action-form':{ActionForm:({children})=>React.createElement('form',null,children)},
 '@/components/ui/submit-button':{SubmitButton:({children})=>React.createElement('button',{type:'submit'},children)},
 '@/features/lookups/lookup-select':{LookupSelect:({label,name,required})=>React.createElement('label',null,label,React.createElement('select',{name,required}))},
 '@/app/app/inventory/actions':{inventoryMutation:()=>{}},
};
const forms=load('src/features/inventory/forms.tsx',shared);
const html=(name,props)=>renderToStaticMarkup(React.createElement(forms[name],{token:'retry',...props}));
test('request form distinguishes recipient from requester, labels destination and exposes quantity constraints and toner printer',()=>{
 const markup=html('RequestForm',{item});assert.match(markup,/Intended employee \(optional\)/);assert.match(markup,/Recipient or destination details/);assert.match(markup,/Printer \(optional, for toner\)/);assert.match(markup,/min="1"/);assert.match(markup,/step="1"/);assert.match(markup,/Submission does not reserve stock/);assert.doesNotMatch(markup,/name="requester/);
});
test('handover requires confirming reserved equipment and recipient before issuance',()=>{
 const markup=html('IssueForm',{request,units:[{asset_id:'asset',asset_context:{tag:'PC-1',name:'Laptop',serial:'SN-1'}}]});assert.match(markup,/type="checkbox" required=""/);assert.match(markup,/required="" name="assets" value="asset"/);assert.match(markup,/Confirm PC-1 · Laptop · SN-1/);assert.match(markup,/Mark as issued/);
});
test('decline and questions require a reason; approval uses individual equipment pickers',()=>{
 assert.match(html('ReviewForm',{request,equipment:false,command:'decline'}),/name="note" required=""/);
 const approval=html('ReviewForm',{request,equipment:true,command:'approve'});assert.equal((approval.match(/name="assets"/g)||[]).length,2);assert.match(approval,/Approve and reserve/);
});
test('people permissions are distinct capabilities with multiple department choices',()=>{
 const markup=html('PermissionsForm',{id:'person',name:'Pat',departments:[{id:'a',name:'A',is_active:true},{id:'b',name:'B',is_active:true}],grants:['a','b'],manager:false});
 assert.match(markup,/<legend>Inventory capabilities for Pat/);assert.match(markup,/Manage inventory and fulfill requests/);assert.equal((markup.match(/name="departments"/g)||[]).length,2);assert.equal((markup.match(/checked=""/g)||[]).length,2);
});
test('inventory table has headers, a keyboard-focusable scroll region, compact labels and available stock arithmetic',()=>{
 const {InventoryTable}=load('src/features/inventory/inventory-table.tsx',{'next/link':{default:({children,...props})=>React.createElement('a',props,children)}});
 const markup=renderToStaticMarkup(React.createElement(InventoryTable,{items:[{...item,location_name:'Central store'}]}));
 assert.match(markup,/role="region" aria-label="Department inventory" tabindex="0"/);assert.match(markup,/responsive-table table-nowrap/);assert.match(markup,/<th scope="col">Department allocation/);assert.match(markup,/data-label="Available">5/);
});
function actionHarness(access,role='end_user') {
 const calls=[];
 return {calls,...load('src/app/app/inventory/actions.ts',{
  'next/cache':{revalidatePath:()=>{}},'@/lib/auth/viewer':{requireViewer:async()=>({role,id:'person',organizationId:'verified-org'})},
  '@/features/inventory/access':{inventoryAccess:async()=>access},'@/lib/supabase/server':{createClient:async()=>({rpc:async(...args)=>{calls.push(args);return{data:'item',error:null};}})},
  '@/lib/server-errors':{reportServerError:()=>{}},
 })};
}
function form(command){const f=new FormData();f.set('command',command);f.set('token','10000000-0000-0000-0000-000000000401');f.set('quantity','2');return f;}
test('server action denies missing capabilities before any database mutation',async()=>{
 const h=actionHarness({manager:false,departments:[]});
 for(const command of ['request','receive','correct','approve','issue','permissions'])assert.ok((await h.inventoryMutation(form(command))).error);
 assert.equal(h.calls.length,0);
});
test('server action retains retry keys and verified organization; failed lookups and invalid quantities cannot save',async()=>{
 const h=actionHarness({manager:true,departments:['department']});const f=form('receive');f.set('organization_id','forged');f.set('id','item');
 await h.inventoryMutation(f);await h.inventoryMutation(f);
 assert.equal(h.calls[0][1].org,'verified-org');assert.equal(h.calls[0][1].token,h.calls[1][1].token);
 f.set('lookupLoadError','1');assert.match((await h.inventoryMutation(f)).error,/retry the lookup/);f.delete('lookupLoadError');f.set('quantity','1.2');assert.match((await h.inventoryMutation(f)).error,/whole/);assert.equal(h.calls.length,2);
});
