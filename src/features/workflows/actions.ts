'use server';
import {revalidatePath} from 'next/cache';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {reportServerError} from '@/lib/server-errors';
import {isUuid} from '@/features/tickets/communications';
import {validateWorkflowDefinition} from './model';
export async function manageWorkflowTemplate(form:FormData):Promise<{error?:string;success?:string;revision?:number;redirectTo?:string}>{
 const viewer=await requireViewer();if(viewer.role!=='administrator')return {error:'Only administrators can edit and publish company procedures.'};
 const target=String(form.get('templateId')??''),operation=String(form.get('operation')??''),revision=Number(form.get('revision'));
 if(!isUuid(target)||!Number.isSafeInteger(revision)||revision<0||!['save','publish','archive','restore'].includes(operation))return {error:'Reload the latest template before saving.'};
 let payload:Record<string,unknown>={};
 if(operation==='save'){
  const raw=String(form.get('definition')??'');if(raw.length>131072)return {error:'This procedure is too large.'};
  let definition:unknown;try{definition=JSON.parse(raw);}catch{return {error:'The procedure could not be read. Your draft is preserved.'};}
  const error=validateWorkflowDefinition(definition);if(error)return {error};payload={definition};
 }else{
  if(form.get('confirm')!=='yes')return {error:'Review and confirm this template action.'};
  if(operation==='publish'){const change_note=String(form.get('changeNote')??'').trim();if(change_note.length<3||change_note.length>1000)return {error:'Describe this published version in 3–1,000 characters.'};payload={change_note};}
 }
 const db=await createClient();const {data,error}=await db.rpc('manage_workflow_template',{org:viewer.organizationId,target,expected_revision:revision,operation,payload:payload as import('@/types/database').Json});
 if(error?.code==='PT409')return {error:'This template changed. Your draft is preserved. Review the saved version and reload before trying again.'};
 if(error){reportServerError('incident.save',error);return {error:'The template could not be saved. Your draft is preserved. Check the fields and try again.'};}
 revalidatePath('/app/workflows');revalidatePath('/app/administration/workflows');revalidatePath(`/app/administration/workflows/${target}`);revalidatePath(`/app/workflows/${target}`);
 return {revision:data!,success:operation==='publish'?'Saved procedure published as a new version.':operation==='save'?'Procedure draft saved.':'Template availability updated.',...(operation==='save'&&revision===0?{redirectTo:`/app/administration/workflows/${target}`}:{})};
}
export async function applyWorkflowTemplate(form:FormData):Promise<{error?:string;success?:string;redirectTo?:string}>{
 const viewer=await requireViewer();if(viewer.role==='end_user')return {error:'Only IT staff can apply company procedures.'};
 const ticket=String(form.get('ticketId')??''),template_id=String(form.get('templateId')??''),token=String(form.get('token')??''),owner_id=String(form.get('ownerId')??''),backup_id=String(form.get('backupId')??''),approver_id=String(form.get('approverId')??''),version=Number(form.get('version')),revision=Number(form.get('ticketRevision'));
 if(![ticket,template_id,token,owner_id].every(isUuid)||(backup_id&&!isUuid(backup_id))||(approver_id&&!isUuid(approver_id))||!Number.isSafeInteger(version)||version<1||!Number.isSafeInteger(revision)||revision<1)return {error:'Review the current ticket, template version and staffing before applying.'};
 if(form.has('lookupLoadError'))return {error:'Retry the staff lookup before applying. Your selections are preserved.'};
 if(form.get('confirm')!=='yes')return {error:'Review the published procedure and confirm its application to this ticket.'};
 const db=await createClient();const {error}=await db.rpc('apply_workflow_template',{org:viewer.organizationId,ticket,template_id,version,token,expected_ticket_revision:revision,payload:{owner_id,backup_id:backup_id||null,approver_id:approver_id||null}});
 if(error?.code==='PT409')return {error:'The ticket, procedure or coordinator changed, or this procedure is already applied. Your selections are preserved. Review the latest ticket and published version before retrying.'};
 if(error){reportServerError('incident.save',error);return {error:'The procedure could not be applied. Check that the ticket is open, incident procedures have an incident declaration, and staff are active. Approval requires a different staff member. Existing work is preserved.'};}
 revalidatePath(`/app/tickets/${ticket}`);revalidatePath('/app/tickets');revalidatePath('/app/notifications');
 return {success:'Published procedure applied.',redirectTo:`/app/tickets/${ticket}#ticket-procedures`};
}
