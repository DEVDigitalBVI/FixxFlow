'use client';
import {useId,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {confirmDiscardChanges} from '@/components/ui/unsaved-changes';
import {LookupSelect} from '@/features/lookups/lookup-select';
import {useTimezone} from '@/features/timezones/provider';
import {DeadlineField} from './deadline-field';
import {manageCommunication} from './communication-actions';
import type {CommunicationPlan,StakeholderGroup,UpdateDraft} from './communications';
export function CommunicationForm({ticketId,targetId,revision=0,operation,label,children,createOnce=false,liveRevision=false}:{ticketId:string;targetId:string;revision?:number;operation:string;label:string;children?:ReactNode;createOnce?:boolean;liveRevision?:boolean}){
 const router=useRouter(),[target,setTarget]=useState(targetId),[version,setVersion]=useState(revision),[saved,setSaved]=useState(false),[failed,setFailed]=useState(false);
 return <ActionForm className="stack" protectDraft={!['publish','remove_member','archive_group','discard_draft'].includes(operation)} action={async form=>{
  const result=await manageCommunication(form);setFailed(Boolean(result.error));if(result.success){setVersion(result.revision!);setSaved(true);router.refresh();}return result;
 }}>
 <input type="hidden" name="ticketId" value={ticketId}/><input type="hidden" name="targetId" value={target}/><input type="hidden" name="operation" value={operation}/><input type="hidden" name="revision" value={liveRevision?revision:version}/>
 {saved&&createOnce?<button className="button button-secondary" type="button" onClick={()=>{setTarget(crypto.randomUUID());setVersion(0);setSaved(false);}}>{operation==='save_group'?'Create another group':'Prepare another update'}</button>:<>{children}<SubmitButton className={`button ${operation==='publish'?'button-primary':'button-secondary'}`} pendingLabel={operation==='publish'?'Approving and queuing…':'Saving…'}>{label}</SubmitButton></>}
 {failed&&<div className="stack"><a className="button button-secondary" href={`/app/tickets/${ticketId}#communication-plan`} target="_blank" rel="noopener noreferrer">Review latest plan (opens in a new tab)</a><button className="button button-secondary" type="button" onClick={()=>{if(confirmDiscardChanges(true))window.location.reload();}}>Reload latest plan</button></div>}
 </ActionForm>;
}
export function PlanEditor({ticketId,ownerId,plan}:{ticketId:string;ownerId:string;plan:CommunicationPlan|null}){
 const zone=useTimezone();
 return <CommunicationForm ticketId={ticketId} targetId={ticketId} revision={plan?.revision??0} operation="save_plan" label="Save communication plan">
 <LookupSelect resource="technicians" searchable="when-paginated" name="ownerId" label="Communication owner" defaultValue={plan?.owner_id??ownerId} required/>
 <DeadlineField timeZone={zone} value={plan?.next_update_at} label="Next update reminder" hint="Optional. Reminds the communication owner when the update is due. Clear to stop reminders."/>
 </CommunicationForm>;
}
export function GroupNameForm({ticketId,targetId,group}:{ticketId:string;targetId:string;group?:StakeholderGroup}){
 const id=useId();return <CommunicationForm ticketId={ticketId} targetId={targetId} revision={group?.revision??0} operation="save_group" label={group?'Rename group':'Create group'} createOnce={!group}>
 <label className="field" htmlFor={id}>Group name *<input className="input" id={id} name="name" required minLength={2} maxLength={100} defaultValue={group?.name??''}/></label>
 </CommunicationForm>;
}
export function AddStakeholder({ticketId,group}:{ticketId:string;group:StakeholderGroup}){
 return <CommunicationForm ticketId={ticketId} targetId={group.id} revision={group.revision} operation="add_member" label="Add company member">
 <LookupSelect resource="people" searchable="when-paginated" name="userId" label={`Member to add to ${group.name}`} required/>
 </CommunicationForm>;
}
export function DraftEditor({ticketId,targetId,groups,draft}:{ticketId:string;targetId:string;groups:StakeholderGroup[];draft?:UpdateDraft}){
 const zone=useTimezone(),id=useId();
 return <CommunicationForm ticketId={ticketId} targetId={targetId} revision={draft?.revision??0} operation="save_draft" label={draft?'Save draft and refresh audience':'Save update draft'} createOnce={!draft}>
 <p className="muted">Required fields are marked *. Saving captures current active members of your selected groups. Nothing is sent until approval.</p>
 <label className="field" htmlFor={`${id}-title`}>Update title *<input className="input" id={`${id}-title`} name="title" required minLength={3} maxLength={180} defaultValue={draft?.title??''}/></label>
 <label className="field" htmlFor={`${id}-body`}>Stakeholder message *<textarea className="input" id={`${id}-body`} name="body" required minLength={3} maxLength={8000} rows={5} defaultValue={draft?.body??''}/></label>
 <fieldset className="stack incident-fields"><legend>Stakeholder groups *</legend><p className="muted">Choose 1–10 groups, up to 500 distinct active recipients.</p>{groups.map(group=><label className="communication-choice" key={group.id}><input type="checkbox" name="groupId" value={group.id} defaultChecked={draft?.group_ids.includes(group.id)}/><span>{group.name}</span></label>)}{!groups.length&&<p>Create a stakeholder group and add members first.</p>}</fieldset>
 <DeadlineField timeZone={zone} value={draft?.next_update_at} label="Next stakeholder update expected" hint="Optional. Sending this update also sets the communication owner's next reminder. Leave empty for no next update."/>
 </CommunicationForm>;
}
