'use server';
import {revalidatePath} from 'next/cache';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {reportServerError} from '@/lib/server-errors';
import {profileLabels} from '@/features/lookups/labels';
import {isUuid} from './communications';
import {parseControl,escalationReasons,type ControlHistoryRow} from './incident-control';
export async function manageIncidentControl(form:FormData):Promise<{error?:string;success?:string;revision?:number}>{
 const viewer=await requireViewer();if(viewer.role==='end_user')return {error:'Only IT staff can manage incident escalation and approvals.'};
 const ticket=String(form.get('ticketId')??''),target=String(form.get('targetId')??''),operation=String(form.get('operation')??''),revision=Number(form.get('revision'));
 if(!isUuid(ticket)||!isUuid(target)||!Number.isSafeInteger(revision)||revision<0)return {error:'Reload the latest ticket before saving.'};
 if(form.has('lookupLoadError'))return {error:'Retry the staff lookup before saving. Your draft is preserved.'};
 const parsed=parseControl(form,operation);if(parsed.error)return {error:parsed.error};
 if(operation==='request_approval'&&(parsed.data!.approver_id===viewer.id||parsed.data!.backup_approver_id===viewer.id))return {error:'Choose another staff member to review your request. You cannot approve your own request.'};
 const db=await createClient();const {data,error}=await db.rpc('manage_incident_control',{org:viewer.organizationId,ticket,target,expected_revision:revision,operation,payload:parsed.data!});
 if(error?.code==='PT409')return {error:'The incident, step or request changed. Your draft is preserved. Review the latest details and reload before trying again.'};
 if(error){reportServerError('incident.save',error);return {error:'This action could not be saved. Check that staff are active and assigned to this role. Only the coordinator or an administrator can configure escalation or request approvals; backup approvers can decide after the deadline.'};}
 revalidatePath(`/app/tickets/${ticket}`);revalidatePath('/app/tickets');revalidatePath('/app/notifications');
 return {revision:data!,success:operation==='request_approval'?'Approval requested. The designated approver has been notified.':operation==='take_over'?'You now own workflow coordination.':'Workflow control updated.'};
}
export async function incidentControlHistory(ticket:string,kind:'escalations'|'approvals'|'changes',before?:number):Promise<{error?:string;rows?:ControlHistoryRow[];hasMore?:boolean}>{
 const viewer=await requireViewer();if(viewer.role==='end_user'||!isUuid(ticket)||!['escalations','approvals','changes'].includes(kind)||(before!==undefined&&(!Number.isSafeInteger(before)||before<1)))return {error:'Workflow history is unavailable.'};
 const db=await createClient();
 if(kind==='escalations'){
  let q=db.from('incident_escalations').select('*').eq('organization_id',viewer.organizationId).eq('ticket_id',ticket);if(before)q=q.lt('id',before);
  const {data,error}=await q.order('id',{ascending:false}).limit(21);if(error)return {error:'Escalation history could not load. Try again.'};
  try{const names=await profileLabels(db,viewer.organizationId,(data??[]).flatMap(e=>e.recipient_ids));const name=(id:string)=>names.find(p=>p.user_id===id)?.display_name??'Profile unavailable';
   return {rows:(data??[]).slice(0,20).map(e=>({id:e.id,title:escalationReasons[e.reason],at:e.created_at,description:`Notified: ${e.recipient_ids.map(name).join(', ')}`})),hasMore:(data?.length??0)>20};
  }catch{return {error:'Staff names could not load. Try again.'};}
 }
 if(kind==='approvals'){
  let q=db.from('incident_approval_history').select('*').eq('organization_id',viewer.organizationId).eq('ticket_id',ticket);if(before)q=q.lt('id',before);
  const {data,error}=await q.order('id',{ascending:false}).limit(21);if(error)return {error:'Approval history could not load. Try again.'};
  try{const names=await profileLabels(db,viewer.organizationId,(data??[]).map(e=>e.actor_id));return {rows:(data??[]).slice(0,20).map(e=>({id:e.id,title:`${e.action}: ${e.snapshot.title}`,at:e.created_at,description:`${names.find(p=>p.user_id===e.actor_id)?.display_name??'Profile unavailable'}${e.snapshot.decision_note?` · ${e.snapshot.decision_note}`:''} · ${e.snapshot.description}${e.snapshot.step_snapshot?` · Saved step: ${e.snapshot.step_snapshot.title} · ${e.snapshot.step_snapshot.instructions}`:''}`})),hasMore:(data?.length??0)>20};}catch{return {error:'Staff names could not load. Try again.'};}
 }
 let q=db.from('incident_control_history').select('*').eq('organization_id',viewer.organizationId).eq('ticket_id',ticket);if(before)q=q.lt('id',before);
 const {data,error}=await q.order('id',{ascending:false}).limit(21);if(error)return {error:'Control history could not load. Try again.'};
 try{const names=await profileLabels(db,viewer.organizationId,(data??[]).flatMap(e=>[e.actor_id,e.snapshot.backup_owner_id,e.snapshot.policy?.backup_owner_id]));const name=(id:string|null|undefined)=>names.find(p=>p.user_id===id)?.display_name??'Not assigned';
  return {rows:(data??[]).slice(0,20).map(e=>({id:e.id,title:e.action==='policy_saved'?'Escalation plan saved':'Incident coordination taken over',at:e.created_at,description:`${name(e.actor_id)} · Backup: ${name(e.snapshot.policy?.backup_owner_id??e.snapshot.backup_owner_id)}${e.snapshot.policy?` · ${e.snapshot.policy.enabled?'Escalation enabled':'Escalation disabled'} · Acknowledgement ${e.snapshot.policy.acknowledgement_minutes} minutes · Overdue grace ${e.snapshot.policy.overdue_minutes} minutes`:''}`})),hasMore:(data?.length??0)>20};
 }catch{return {error:'Staff names could not load. Try again.'};}
}
