'use client';
import {useId,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {confirmDiscardChanges} from '@/components/ui/unsaved-changes';
import {LookupSelect} from '@/features/lookups/lookup-select';
import {useTimezone} from '@/features/timezones/provider';
import {DeadlineField} from './deadline-field';
import {manageIncidentControl} from './incident-control-actions';
import type {EscalationPolicy,IncidentApproval} from './incident-control';
export function IncidentControlForm({ticketId,targetId,revision=0,operation,label,children,createOnce=false}:{ticketId:string;targetId:string;revision?:number;operation:string;label:string;children?:ReactNode;createOnce?:boolean}){
 const router=useRouter(),[target,setTarget]=useState(targetId),[version,setVersion]=useState(revision),[saved,setSaved]=useState(false),[failed,setFailed]=useState(false);
 return <ActionForm className="stack" action={async form=>{const result=await manageIncidentControl(form);setFailed(Boolean(result.error));if(result.success){setVersion(result.revision!);setSaved(true);router.refresh();}return result;}}>
 <input type="hidden" name="ticketId" value={ticketId}/><input type="hidden" name="targetId" value={target}/><input type="hidden" name="revision" value={version}/><input type="hidden" name="operation" value={operation}/>
 {saved&&createOnce?<button className="button button-secondary" type="button" onClick={()=>{setTarget(crypto.randomUUID());setVersion(0);setSaved(false);}}>Request another approval</button>:<>{children}<SubmitButton className={`button ${operation==='approve'?'button-primary':'button-secondary'}`} pendingLabel="Saving…">{label}</SubmitButton></>}
 {failed&&<div className="stack"><a className="button button-secondary" href={`/app/tickets/${ticketId}#incident-approvals`} target="_blank" rel="noopener noreferrer">Review latest controls (opens in a new tab)</a><button className="button button-secondary" type="button" onClick={()=>{if(confirmDiscardChanges(true))window.location.reload();}}>Reload latest ticket</button></div>}
 </ActionForm>;
}
export function EscalationEditor({ticketId,policy}:{ticketId:string;policy:EscalationPolicy|null}){
 const id=useId();return <IncidentControlForm ticketId={ticketId} targetId={ticketId} revision={policy?.revision??0} operation="save_policy" label="Save escalation plan">
 <LookupSelect resource="technicians" searchable="when-paginated" name="backupOwnerId" label="Backup coordinator" defaultValue={policy?.backup_owner_id??''}/>
 <label className="communication-choice"><input type="checkbox" name="enabled" value="yes" defaultChecked={policy?.enabled??false}/><span>Enable response and communication escalation</span></label>
 <label className="field" htmlFor={`${id}-ack`}>Acknowledgement time (minutes) *<input className="input" id={`${id}-ack`} type="number" name="acknowledgementMinutes" min={1} max={1440} required defaultValue={policy?.acknowledgement_minutes??30}/></label>
 <label className="field" htmlFor={`${id}-grace`}>Overdue grace (minutes) *<input className="input" id={`${id}-grace`} type="number" name="overdueMinutes" min={0} max={1440} required defaultValue={policy?.overdue_minutes??15}/></label>
 <p className="muted">Acknowledgement time starts at assignment, reassignment or reopening. Overdue grace applies after response-step and stakeholder-update deadlines. Approval backups may decide after the approval deadline; overdue alerts use this grace when configured. Times include nights and weekends.</p>
 </IncidentControlForm>;
}
export function ApprovalRequestEditor({ticketId,targetId,steps,backupId}:{ticketId:string;targetId:string;steps:{id:string;title:string}[];backupId?:string|null}){
 const id=useId(),zone=useTimezone();return <IncidentControlForm ticketId={ticketId} targetId={targetId} operation="request_approval" label="Request approval" createOnce>
 <p className="muted">Required fields are marked *. The requester cannot approve their own request. Linking a step prevents it from being marked complete until its current details are approved. A new request replaces that step’s earlier approval request.</p>
 <label className="field" htmlFor={`${id}-title`}>Decision title *<input className="input" id={`${id}-title`} name="title" required minLength={3} maxLength={180}/></label>
 <label className="field" htmlFor={`${id}-description`}>Decision details *<textarea className="input" id={`${id}-description`} name="description" required minLength={3} maxLength={4000} rows={4}/></label>
 <label className="field" htmlFor={`${id}-step`}>Applies to<select className="input" id={`${id}-step`} name="stepId"><option value="">Standalone decision</option>{steps.map(step=><option key={step.id} value={step.id}>{step.title}</option>)}</select></label>
 <LookupSelect resource="technicians" searchable="when-paginated" name="approverId" label="Primary approver" required/>
 <LookupSelect resource="technicians" searchable="when-paginated" name="backupApproverId" label="Backup approver" defaultValue={backupId??''}/>
 <DeadlineField timeZone={zone} label="Decision deadline *" required hint="Required. A designated backup approver can decide after this time."/>
 </IncidentControlForm>;
}
export function ApprovalDecisionForm({ticketId,approval,operation}:{ticketId:string;approval:IncidentApproval;operation:'approve'|'reject'|'cancel_approval'}){
 const id=useId(),label=operation==='approve'?'Approve decision':operation==='reject'?'Reject decision':'Cancel approval request';
 return <IncidentControlForm ticketId={ticketId} targetId={approval.id} revision={approval.revision} operation={operation} label={label}>
 <label className="field" htmlFor={id}>Reason *<textarea className="input" id={id} name="note" required minLength={3} maxLength={2000} rows={3}/></label>
 <label className="communication-choice"><input type="checkbox" name="confirm" value="yes" required/><span>{operation==='cancel_approval'?'Cancel this request. A linked step will no longer require this approval.':`I reviewed this saved request and ${operation==='approve'?'approve':'reject'} the described decision.`}</span></label>
 </IncidentControlForm>;
}
