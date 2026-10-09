import assert from 'node:assert/strict';
import test from 'node:test';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
const {resolveTimezone,validTimezone}=load('src/features/timezones/model.ts');
const {parseDeadline,deadlineCandidates,deadlineInputValue}=load('src/features/tickets/deadlines.ts');
test('explicit preference wins over device, with organization and UTC fallbacks',()=>{
 assert.equal(resolveTimezone('Asia/Tokyo','Europe/London','America/Tortola'),'Asia/Tokyo');
 assert.equal(resolveTimezone(null,'Europe/London','America/Tortola'),'Europe/London');
 assert.equal(resolveTimezone(null,'invalid','America/Tortola'),'America/Tortola');
 assert.equal(resolveTimezone('bad',null,'bad'),'UTC');
 for(const value of ['EST','+04:00','UTC-4','Invalid/Zone',null])assert.equal(validTimezone(value),false);
});
test('deadlines handle DST gaps, folds and fractional offsets without the host timezone',()=>{
 assert.equal(parseDeadline('2026-03-08T02:30','America/New_York'),undefined);
 assert.deepEqual(deadlineCandidates('2026-11-01T01:30','America/New_York'),['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z']);
 assert.equal(parseDeadline('2026-11-01T01:30','America/New_York'),undefined);
 assert.equal(parseDeadline('2026-11-01T01:30','America/New_York','later'),'2026-11-01T06:30:00.000Z');
 assert.equal(parseDeadline('2026-11-01T01:30','America/New_York','earlier'),'2026-11-01T05:30:00.000Z');
 assert.equal(parseDeadline('2026-10-09T09:00','Asia/Kathmandu'),'2026-10-09T03:15:00.000Z');
 assert.equal(deadlineCandidates('2026-04-05T01:45','Australia/Lord_Howe').length,2);
 assert.equal(parseDeadline('2026-10-04T02:15','Australia/Lord_Howe'),undefined);
 assert.equal(deadlineInputValue('2026-10-09T13:00:00Z','Asia/Tokyo'),'2026-10-09T22:00');
 assert.equal(parseDeadline('','bad'),undefined);
});
test('deadline draft pins its timezone and retains the saved occurrence across prop refreshes',()=>{
 const props={timeZone:'America/New_York',value:'2026-11-01T06:30:00Z'},h=componentHarness('src/features/tickets/deadline-field.tsx','DeadlineField',props);
 try {
  assert.equal(h.find(n=>n.props.name==='dueOccurrence').props.value,'later');
  props.timeZone='Asia/Tokyo';props.value=null;h.render();
  assert.equal(h.find(n=>n.props.name==='dueTimezone').props.value,'America/New_York');
  assert.equal(h.find(n=>n.props.name==='dueAt').props.value,'2026-11-01T01:30');
  h.find(n=>n.props.name==='dueAt').props.onChange({target:{value:'2026-03-08T02:30'}});h.render();
  assert.match(h.find(n=>n.props.role==='alert').props.children,/does not exist/);
 }finally{h.close();}
});
test('device detection writes a presentation-only cookie and refreshes at most once',()=>{
 for(const preference of [null,'Asia/Tokyo']){
  let refreshes=0;
  const h=componentHarness('src/features/timezones/provider.tsx','TimezoneProvider',{timeZone:'Pacific/Auckland',preference,children:null},{'next/navigation':{useRouter:()=>{globalThis.window.location={protocol:'https:'};return {refresh:()=>refreshes++};}}});
  try{
   assert.match(globalThis.document.cookie,/^fixxflow-timezone=.+; Path=\//);
   assert.match(globalThis.document.cookie,/SameSite=Lax; Secure/);
   h.render();h.render();assert.equal(refreshes,preference?0:1);
  }finally{h.close();}
 }
});
test('timezone actions enforce administrators, validate zones and scope optimistic writes',async()=>{
 for(const [scope,role,zone] of [['organization','end_user','UTC'],['personal','end_user','Bogus/Zone'],['personal','end_user','Asia/Tokyo'],['organization','administrator','Europe/London']]){
  const calls=[];
  const query=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:{timezone:zone},error:null}).then(resolve):(...args)=>{calls.push([key,...args]);return query;}});
  const {saveTimezone}=load('src/features/timezones/actions.ts',{'next/cache':{revalidatePath(){}},'@/lib/auth/viewer':{requireViewer:async()=>({id:'me',organizationId:'org',role})},'@/lib/supabase/server':{createClient:async()=>({from:table=>{calls.push(['from',table]);return query;}})}});
  const result=await saveTimezone(new Map(Object.entries({scope,timezone:zone,expectedTimezone:scope==='personal'?'':'UTC'})));
  const allowed=zone!=='Bogus/Zone'&&(scope!=='organization'||role==='administrator');
  assert.equal(Boolean(result.success),allowed);
  if(!allowed)assert.equal(calls.length,0);
  else {assert.ok(calls.some(c=>c[0]==='eq'&&c[1]===(scope==='personal'?'organization_id':'id')&&c[2]==='org'));assert.ok(calls.some(c=>c[0]===(scope==='personal'?'is':'eq')&&c[1]==='timezone'));}
 }
});
test('timezone settings keep their original write guard during background refreshes',async()=>{
 const props={scope:'personal',initial:'Asia/Tokyo',children:null};
 const h=componentHarness('src/features/timezones/settings-form.tsx','TimezoneSettingsForm',props,{'./actions':{saveTimezone:async()=>({success:'Saved'})}});
 try{
  props.initial='Europe/London';h.render();
  assert.equal(h.find(n=>n.props.name==='expectedTimezone').props.value,'Asia/Tokyo');
  await h.render().props.action(new Map([['timezone','America/Tortola']]));h.render();
  assert.equal(h.find(n=>n.props.name==='expectedTimezone').props.value,'America/Tortola');
 }finally{h.close();}
});
