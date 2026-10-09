import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
const id='10000000-0000-4000-8000-000000000001';
function actions({role='technician',failTable='',failWrite=false,missing=false,revision=1,race=false}={}) {
 const calls=[],logged=[];
 const db={from(table){let writing=false;const query=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:table==='tickets'?missing?null:writing&&race?null:{id,category_id:null,subcategory_id:null,revision:writing?revision+1:revision}:table==='profiles'?{user_id:id}:null,error:table===failTable||(failWrite&&writing)?{code:'08006',message:'secret'}:null}).then(resolve):(...args)=>{if(key==='update')writing=true;calls.push([table,key,...args]);return query;}});return query;}};
 const mocks={'next/cache':{revalidatePath(){}},'next/navigation':{redirect(){throw Error('Failure must not redirect');}},'@/lib/auth/viewer':{requireViewer:async()=>({id,role,organizationId:'trusted-org'})},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/server-errors':{reportServerError:(...args)=>{logged.push(args);return 'reference';}}};
 return {...load('src/app/app/tickets/actions.ts',mocks),...load('src/app/app/profile/actions.ts',mocks),calls,logged};
}
const form=()=>new Map(Object.entries({ticketId:id,revision:1,status:'open',priority:'normal',assignedTechnicianId:'',teamId:'',categoryId:'',subcategoryId:'',locationId:'',dueAt:''}));
test('ticket validation, lookup outage, missing ticket and database failure return recoverable state',async()=>{
 for(const setup of [{role:'end_user'},{failTable:'tickets'},{missing:true},{}]){
  const a=actions(setup),data=form();if(!Object.keys(setup).length)data.set('lookupLoadError','true');
  const result=await a.updateTicket(data);assert.ok(result.error);assert.equal(a.calls.some(c=>c[1]==='update'),false);
 }
 const a=actions(),data=form();data.set('status','invalid');assert.ok((await a.updateTicket(data)).error);assert.equal(a.calls.length,0);
});
test('ticket save returns success without redirect and retains tenant filters',async()=>{
 const a=actions();assert.deepEqual(await a.updateTicket(form()),{success:'Ticket updated.',revision:2});
 assert.ok(a.calls.some(c=>c[1]==='update'));assert.ok(a.calls.some(c=>c[1]==='eq'&&c[2]==='organization_id'&&c[3]==='trusted-org'));
});
test('a failed ticket write preserves the form and records diagnostic context',async()=>{
 const a=actions({failWrite:true});assert.ok((await a.updateTicket(form())).error);
 assert.ok(a.calls.some(c=>c[1]==='update'));assert.equal(a.logged[0][0],'ticket.save');
});
test('profile saves guard missing references and detect failed writes without redirecting',async()=>{
 const a=actions({failTable:'profiles'}),data=new Map(Object.entries({displayName:'Draft name',departmentId:'',locationId:''}));
 assert.match((await a.updateProfile(data)).error,/entries are preserved/);assert.equal(a.logged[0][0],'profile.save');
 data.delete('locationId');a.calls.length=0;assert.ok((await a.updateProfile(data)).error);assert.equal(a.calls.length,0);
});

test('ticket edits reject stale revisions and guard the atomic write against a competing update',async()=>{
 const stale=actions({revision:2});assert.match((await stale.updateTicket(form())).error,/changed while you were editing/);assert.ok(!stale.calls.some(c=>c[1]==='update'));
 const race=actions({race:true});assert.match((await race.updateTicket(form())).error,/changed while you were editing/);assert.ok(race.calls.some(c=>c[1]==='eq'&&c[2]==='revision'&&c[3]===1));
 for(const revision of ['', '0', '-1', '1.5', '9007199254740992', 'invalid']){const a=actions(),data=form();data.set('revision',revision);assert.ok((await a.updateTicket(data)).error);assert.equal(a.calls.length,0);}
});
test('manual deadlines are saved with an explicit offset and impossible dates never write',async()=>{
 const a=actions(),data=form();data.set('dueAt','2026-10-09T09:00');assert.ok((await a.updateTicket(data)).success);assert.equal(a.calls.find(c=>c[1]==='update')[2].due_at,'2026-10-09T13:00:00.000Z');
 const invalid=actions();data.set('dueAt','2026-02-30T09:00');assert.match((await invalid.updateTicket(data)).error,/valid manual due date/);assert.equal(invalid.calls.length,0);
});
