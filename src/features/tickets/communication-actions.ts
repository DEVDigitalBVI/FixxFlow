'use server';
import {revalidatePath} from 'next/cache';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {reportServerError} from '@/lib/server-errors';
import {communicationPayload,isUuid} from './communications';
export async function manageCommunication(form:FormData):Promise<{error?:string;success?:string;revision?:number}>{
 const viewer=await requireViewer();if(viewer.role==='end_user')return {error:'Only IT staff can coordinate workflow communications.'};
 const ticket=String(form.get('ticketId')??''),target=String(form.get('targetId')??''),operation=String(form.get('operation')??''),revision=Number(form.get('revision'));
 if(!isUuid(ticket)||!isUuid(target)||!Number.isSafeInteger(revision)||revision<0)return {error:'Reload the latest communication plan before saving.'};
 if(form.has('lookupLoadError'))return {error:'Retry the member lookup before saving. Your draft is preserved.'};
 const parsed=communicationPayload(form,operation);if(parsed.error)return {error:parsed.error};
 const db=await createClient();
 const {data,error}=await db.rpc('manage_incident_communication',{org:viewer.organizationId,ticket,target,expected_revision:revision,operation,payload:parsed.data!});
 if(error?.code==='PT409')return {error:'These details changed. Your draft is preserved. Review the latest plan and reload before trying again.'};
 if(error){reportServerError('incident.save',error);return {error:operation==='publish'?'The update could not be approved. Only the coordinator or an administrator can send it. Check that the saved recipients are still active; save the draft again to refresh its audience.':'The change could not be saved. Check that the selected members and groups are active and within the displayed limits. Your draft is preserved.'};}
 revalidatePath(`/app/tickets/${ticket}`);revalidatePath('/app/tickets');revalidatePath('/app/notifications');
 return {revision:data!,success:operation==='publish'?'Update approved and queued for delivery.':operation==='save_draft'?'Draft saved with its audience. Review it below before approval.':'Communication plan updated.'};
}

export async function olderIncidentUpdates(ticket:string,before:{at:string;id:string}){
 const viewer=await requireViewer();if(viewer.role==='end_user'||!isUuid(ticket)||!isUuid(before?.id??'')||!Number.isFinite(Date.parse(before?.at??'')))return {error:'Approved updates are unavailable.'};
 const db=await createClient(),at=new Date(before.at).toISOString();
 const {data,error}=await db.from('incident_bulletins').select('*').eq('organization_id',viewer.organizationId).eq('ticket_id',ticket).or(`approved_at.lt.${at},and(approved_at.eq.${at},id.lt.${before.id})`).order('approved_at',{ascending:false}).order('id',{ascending:false}).limit(21);
 if(error){reportServerError('incident.save',error);return {error:'Earlier updates could not load. Try again.'};}
 const rows=(data??[]).slice(0,20);
 const delivery=rows.length?await db.rpc('incident_delivery_summary',{org:viewer.organizationId,ticket,bulletins:rows.map(r=>r.id)}):{data:[],error:null};
 return {rows,hasMore:(data?.length??0)>20,delivery:delivery.data??[],deliveryError:Boolean(delivery.error)};
}
