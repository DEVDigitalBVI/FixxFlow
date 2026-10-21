'use client';
import {useId,useState} from 'react';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {LookupSelect} from '@/features/lookups/lookup-select';
import {confirmDiscardChanges} from '@/components/ui/unsaved-changes';
import {useRouter} from 'next/navigation';
import {manageWorkflowTemplate,applyWorkflowTemplate} from './actions';
import {needsBackup,needsApprover,type WorkflowDefinition} from './model';
export function TemplateCommand({templateId,revision,operation}:{templateId:string;revision:number;operation:'publish'|'archive'|'restore'}){
 const id=useId(),router=useRouter();
 return <ActionForm className="stack" action={async data=>{if(operation==='archive'&&!confirmDiscardChanges())return {error:'Archiving cancelled. Save your draft or discard its changes first.'};const result=await manageWorkflowTemplate(data);if(result.success)router.refresh();return result;}}>
 <input type="hidden" name="templateId" value={templateId}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="operation" value={operation}/>
 {operation==='publish'&&<label className="field" htmlFor={id}>Version notes *<textarea className="input" id={id} name="changeNote" required minLength={3} maxLength={1000} rows={3}/></label>}
 <label className="communication-choice"><input key={revision} type="checkbox" name="confirm" value="yes" required/><span>{operation==='publish'?'I reviewed the saved draft above. Publish this version for staff to use.':operation==='archive'?'Stop new applications of this template. Existing tickets keep their applied versions.':'Make the published procedure available to staff again.'}</span></label>
 <SubmitButton className={`button ${operation==='publish'?'button-primary':'button-secondary'}`} pendingLabel="Saving…">{operation==='publish'?'Publish saved draft':operation==='archive'?'Archive template':'Restore template'}</SubmitButton>
 </ActionForm>;
}
export function ApplyTemplateForm({ticketId,ticketRevision,templateId,version,token,definition,ownerId,chooseOwner,backupId,backupName}:{ticketId:string;ticketRevision:number;templateId:string;version:number;token:string;definition:WorkflowDefinition;ownerId:string;chooseOwner:boolean;backupId?:string|null;backupName?:string}){
 const [command]=useState({ticketId,ticketRevision,templateId,version,token,ownerId,backupId}),[failed,setFailed]=useState(false),id=useId();
 return <ActionForm className="stack" action={async data=>{const result=await applyWorkflowTemplate(data);setFailed(Boolean(result.error));return result;}}>
 <input type="hidden" name="ticketId" value={command.ticketId}/><input type="hidden" name="ticketRevision" value={command.ticketRevision}/><input type="hidden" name="templateId" value={command.templateId}/><input type="hidden" name="version" value={command.version}/><input type="hidden" name="token" value={command.token}/>
 {chooseOwner?<LookupSelect resource="technicians" searchable="when-paginated" name="ownerId" label="Coordinator" defaultValue={ownerId} required/>:<input type="hidden" name="ownerId" value={command.ownerId}/>}
 {command.backupId?<><input type="hidden" name="backupId" value={command.backupId}/><p>Backup coordinator: {backupName??'Staff profile unavailable'} · Existing escalation plan</p></>:needsBackup(definition)?<LookupSelect resource="technicians" searchable="when-paginated" name="backupId" label="Backup coordinator" required/>:null}
 {needsApprover(definition)&&<LookupSelect resource="technicians" searchable="when-paginated" name="approverId" label="Primary approver for required decisions" required/>}
 {needsApprover(definition)&&<p className="muted">Choose an approver other than yourself. An eligible backup coordinator can provide backup approval.</p>}
 <p className="muted">This adds {definition.steps.length} checklist {definition.steps.length===1?'step':'steps'}. Deadlines start when you apply it. Existing work is kept, and no updates are sent automatically.</p>
 <label className="communication-choice" htmlFor={id}><input id={id} type="checkbox" name="confirm" value="yes" required/><span>Apply this published version to this ticket. Add its steps and approval requests, preserve existing work and settings, and start new deadlines from now. Add recipients to new stakeholder groups before sending updates.</span></label>
 <SubmitButton className="button button-primary" pendingLabel="Applying procedure…">Apply published procedure</SubmitButton>
 {failed&&<div className="stack"><a className="button button-secondary" href={`/app/workflows/${templateId}?ticket=${ticketId}`} target="_blank" rel="noopener noreferrer">Review latest published procedure (opens in a new tab)</a><button className="button button-secondary" type="button" onClick={()=>{if(confirmDiscardChanges(true))window.location.reload();}}>Reload current procedure</button></div>}
 <a className="button button-secondary" href={`/app/tickets/${ticketId}`} target="_blank" rel="noopener noreferrer">Review current ticket (opens in a new tab)</a>
 </ActionForm>;
}
