import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
const initial={id:'ticket',revision:1,status:'open',priority:'normal',assigned_technician_id:null,team_id:null,category_id:null,subcategory_id:null,location_id:null,due_at:'2026-10-09T13:00:00Z'};
function editor(result={success:'Saved',revision:2}){
 const props={ticket:{...initial},timeZone:'America/Tortola'};let refreshes=0;
 const harness=componentHarness('src/features/tickets/ticket-details-form.tsx','TicketDetailsForm',props,{
  'next/navigation':{useRouter:()=>({refresh:()=>refreshes++})},
  '@/app/app/tickets/actions':{updateTicket:async()=>result},
 });
 return {harness,props,refreshes:()=>refreshes};
}
test('realtime refresh preserves the draft fields and expected revision while exposing review and explicit reload',()=>{
 const {harness:h,props}=editor();
 try{
  assert.equal(h.find(n=>n.props.timeZone==='America/Tortola').props.value,initial.due_at);
  props.ticket={...initial,revision:2,status:'closed',due_at:null};h.render();
  assert.equal(h.find(n=>n.props.name==='revision').props.value,1);assert.equal(h.find(n=>n.props.name==='status').props.defaultValue,'open');
  assert.equal(h.find(n=>n.props.timeZone==='America/Tortola').props.value,initial.due_at);
  assert.equal(h.find(n=>n.type==='a').props.target,'_blank');
  assert.equal(h.find(n=>n.type==='button').props.type,'button');
  let reloaded=false;globalThis.window.location={reload:()=>reloaded=true};globalThis.window.confirm=()=>false;
  h.find(n=>n.type==='button').props.onClick();assert.equal(reloaded,false);
  globalThis.window.confirm=()=>true;h.find(n=>n.type==='button').props.onClick();assert.equal(reloaded,true);
 }finally{h.close();}
});
test('successful saves advance the draft revision; conflicts refresh saved data without replacing the draft',async()=>{
 for(const result of [{success:'Saved',revision:2},{error:'Changed',conflict:true},{error:'Invalid deadline'}]){
  const {harness:h,props,refreshes}=editor(result);
  try{
   await h.render().props.action(new FormData());props.ticket={...initial,revision:result.success?2:1};h.render();
   assert.equal(h.find(n=>n.props.name==='revision').props.value,result.success?2:1);
   assert.equal(refreshes(),result.conflict?1:0);
   assert.equal(h.all(n=>n.type==='a').length,result.conflict?1:0);
  }finally{h.close();}
 }
});
test('submission keys stay attached to their mounted drafts across refreshed server props',()=>{
 const props={value:'original-key'},h=componentHarness('src/components/ui/submission-key.tsx','SubmissionKey',props);
 try{props.value='new-server-key';assert.equal(h.render().props.value,'original-key');}finally{h.close();}
});
