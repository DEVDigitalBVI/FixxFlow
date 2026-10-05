import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
const id='10000000-0000-4000-8000-000000000001';
function actions({role='technician',failTable='',failWrite=false,missing=false}={}) {
 const calls=[],logged=[];
 const db={from(table){let writing=false;const query=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:table==='tickets'?missing?null:{id,category_id:null,subcategory_id:null}:table==='profiles'?{user_id:id}:null,error:table===failTable||(failWrite&&writing)?{code:'08006',message:'secret'}:null}).then(resolve):(...args)=>{if(key==='update')writing=true;calls.push([table,key,...args]);return query;}});return query;}};
 const mocks={'next/cache':{revalidatePath(){}},'next/navigation':{redirect(){throw Error('Failure must not redirect');}},'@/lib/auth/viewer':{requireViewer:async()=>({id,role,organizationId:'trusted-org'})},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/server-errors':{reportServerError:(...args)=>{logged.push(args);return 'reference';}}};
 return {...load('src/app/app/tickets/actions.ts',mocks),...load('src/app/app/profile/actions.ts',mocks),calls,logged};
}
const form=()=>new Map(Object.entries({ticketId:id,status:'open',priority:'normal',assignedTechnicianId:'',teamId:'',categoryId:'',subcategoryId:'',locationId:'',dueAt:''}));
test('ticket validation, lookup outage, missing ticket and database failure return recoverable state',async()=>{
 for(const setup of [{role:'end_user'},{failTable:'tickets'},{missing:true},{}]){
  const a=actions(setup),data=form();if(!Object.keys(setup).length)data.set('lookupLoadError','true');
  const result=await a.updateTicket(data);assert.ok(result.error);assert.equal(a.calls.some(c=>c[1]==='update'),false);
 }
 const a=actions(),data=form();data.set('status','invalid');assert.ok((await a.updateTicket(data)).error);assert.equal(a.calls.length,0);
});
test('ticket save returns success without redirect and retains tenant filters',async()=>{
 const a=actions();assert.deepEqual(await a.updateTicket(form()),{success:'Ticket updated.'});
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
