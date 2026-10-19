'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {useUnsavedChanges,confirmDiscardChanges} from '@/components/ui/unsaved-changes';
import {manageWorkflowTemplate} from './actions';
import {newProcedureStep,workflowKinds,type WorkflowDefinition,type ProcedureStep} from './model';
export function TemplateBuilder({templateId,revision,initial}:{templateId:string;revision:number;initial:WorkflowDefinition}){
 const id=useId(),[draft,setDraft]=useState(initial),[version,setVersion]=useState(revision),[groups,setGroups]=useState(initial.communication.group_names.join('\n')),[failed,setFailed]=useState(false),[announcement,setAnnouncement]=useState('');
 const normalized={...draft,communication:{...draft.communication,group_names:groups.split(/\r?\n/).map(n=>n.trim()).filter(Boolean)}};
 const serialized=JSON.stringify(normalized),[saved,setSaved]=useState(JSON.stringify(initial));
 const effectiveRevision=JSON.stringify(initial)===saved?Math.max(version,revision):version;
 const release=useUnsavedChanges(serialized!==saved),focusStep=useRef<string|null>(null);
 useEffect(()=>{if(focusStep.current){document.getElementById(`${id}-${focusStep.current}-title`)?.focus();focusStep.current=null;}},[draft.steps,id]);
 const changeStep=(key:string,patch:Partial<ProcedureStep>)=>setDraft(prev=>({...prev,steps:prev.steps.map(s=>s.id===key?{...s,...patch}:s)}));
 const move=(index:number,delta:number)=>{focusStep.current=draft.steps[index].id;setDraft(prev=>{const steps=[...prev.steps];[steps[index],steps[index+delta]]=[steps[index+delta],steps[index]];return {...prev,steps};});setAnnouncement(`Step moved to position ${index+delta+1}.`);};
 const number=(value:string)=>value===''?null:Number(value);
 return <ActionForm className="stack workflow-builder" action={async form=>{const result=await manageWorkflowTemplate(form);setFailed(Boolean(result.error));if(result.success){release();setSaved(serialized);setVersion(result.revision!);}return result;}}>
 <input type="hidden" name="templateId" value={templateId}/><input type="hidden" name="operation" value="save"/><input type="hidden" name="revision" value={effectiveRevision}/><input type="hidden" name="definition" value={serialized}/>
 <p className="muted">Required fields are marked *. Save a draft, review its saved content, then publish a version for staff to use.</p>
 <label className="field" htmlFor={`${id}-name`}>Procedure name *<input className="input" id={`${id}-name`} required minLength={3} maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label className="field" htmlFor={`${id}-kind`}>Procedure type *<select className="input" id={`${id}-kind`} value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as WorkflowDefinition['kind']})}>{Object.entries(workflowKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <label className="field" htmlFor={`${id}-description`}>Description<textarea className="input" id={`${id}-description`} rows={3} maxLength={2000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
 <div className="section-heading-row"><h2>Response steps</h2><span className="muted">{draft.steps.length} of 20 steps</span></div>
 <p className="muted">Assign steps to the coordinator or backup selected when applying the procedure. Deadlines are minutes from application, including nights and weekends.</p>
 <span role="status" className="muted">{announcement}</span>
 {draft.steps.map((step,index)=><fieldset className="stack incident-fields" key={step.id}><legend>Step {index+1}</legend>
 <label className="field" htmlFor={`${id}-${step.id}-title`}>Step title *<input className="input" id={`${id}-${step.id}-title`} required minLength={3} maxLength={180} value={step.title} onChange={e=>changeStep(step.id,{title:e.target.value})}/></label>
 <label className="field" htmlFor={`${id}-${step.id}-instructions`}>Instructions<textarea className="input" id={`${id}-${step.id}-instructions`} maxLength={4000} rows={3} value={step.instructions} onChange={e=>changeStep(step.id,{instructions:e.target.value})}/></label>
 <label className="field" htmlFor={`${id}-${step.id}-assignee`}>Assigned role<select className="input" id={`${id}-${step.id}-assignee`} value={step.assignee} onChange={e=>changeStep(step.id,{assignee:e.target.value as ProcedureStep['assignee']})}><option value="owner">Coordinator</option><option value="backup">Backup coordinator</option></select></label>
 <label className="field" htmlFor={`${id}-${step.id}-due`}>Step deadline after application (minutes)<input className="input" id={`${id}-${step.id}-due`} type="number" min={1} max={43200} value={step.due_minutes??''} onChange={e=>changeStep(step.id,{due_minutes:number(e.target.value)})}/></label>
 <label className="communication-choice"><input type="checkbox" checked={step.approval_required} onChange={e=>changeStep(step.id,{approval_required:e.target.checked,approval_minutes:step.approval_minutes??60})}/><span>Require approval before marking this step complete</span></label>
 {step.approval_required&&<label className="field" htmlFor={`${id}-${step.id}-approval`}>Decision deadline after application (minutes) *<input className="input" id={`${id}-${step.id}-approval`} type="number" required min={1} max={43200} value={step.approval_minutes??''} onChange={e=>changeStep(step.id,{approval_minutes:number(e.target.value)})}/></label>}
 <div className="workflow-builder-actions"><button className="button button-quiet" type="button" disabled={index===0} onClick={()=>move(index,-1)} aria-label={`Move step ${index+1} up`}>Move up</button><button className="button button-quiet" type="button" disabled={index===draft.steps.length-1} onClick={()=>move(index,1)} aria-label={`Move step ${index+1} down`}>Move down</button><button className="button button-quiet" type="button" disabled={draft.steps.length===1} onClick={()=>{if(window.confirm(`Remove step ${index+1} from this draft?`)){focusStep.current=draft.steps[index?index-1:1].id;setDraft({...draft,steps:draft.steps.filter(s=>s.id!==step.id)});setAnnouncement('Draft step removed.');}}} aria-label={`Remove step ${index+1}`}>Remove step</button></div>
 </fieldset>)}
 <button className="button button-secondary" type="button" disabled={draft.steps.length>=20} onClick={()=>{const step=newProcedureStep();focusStep.current=step.id;setDraft({...draft,steps:[...draft.steps,step]});setAnnouncement('Step added.');}}>Add response step</button>
 <details><summary>Communication guidance</summary><div className="stack">
 <label className="field" htmlFor={`${id}-groups`}>Stakeholder group names<textarea className="input" id={`${id}-groups`} rows={3} maxLength={1020} value={groups} onChange={e=>setGroups(e.target.value)}/></label><p className="muted">One name per line, up to 10. Applying creates empty groups where needed. Staff add company members before preparing an approved update.</p>
 <label className="field" htmlFor={`${id}-guidance`}>Communication guidance<textarea className="input" id={`${id}-guidance`} rows={4} maxLength={4000} value={draft.communication.guidance} onChange={e=>setDraft({...draft,communication:{...draft.communication,guidance:e.target.value}})}/></label>
 <label className="field" htmlFor={`${id}-reminder`}>First update reminder after application (minutes)<input className="input" id={`${id}-reminder`} type="number" min={1} max={43200} value={draft.communication.next_update_minutes??''} onChange={e=>setDraft({...draft,communication:{...draft.communication,next_update_minutes:number(e.target.value)}})}/></label>
 </div></details>
 <details><summary>Escalation defaults</summary><div className="stack">
 <label className="communication-choice"><input type="checkbox" checked={draft.escalation.enabled} onChange={e=>setDraft({...draft,escalation:{...draft.escalation,enabled:e.target.checked}})}/><span>Enable response and communication escalation</span></label>
 <label className="field" htmlFor={`${id}-ack`}>Acknowledgement time (minutes) *<input className="input" id={`${id}-ack`} type="number" min={1} max={1440} required value={draft.escalation.acknowledgement_minutes} onChange={e=>setDraft({...draft,escalation:{...draft.escalation,acknowledgement_minutes:Number(e.target.value)}})}/></label>
 <label className="field" htmlFor={`${id}-grace`}>Overdue grace (minutes) *<input className="input" id={`${id}-grace`} type="number" min={0} max={1440} required value={draft.escalation.overdue_minutes} onChange={e=>setDraft({...draft,escalation:{...draft.escalation,overdue_minutes:Number(e.target.value)}})}/></label>
 <p className="muted">Existing ticket escalation and communication settings are preserved when another procedure is applied.</p>
 </div></details>
 <SubmitButton className="button button-primary" pendingLabel="Saving draft…">Save procedure draft</SubmitButton>
 {failed&&<div className="stack"><a className="button button-secondary" href={`/app/administration/workflows/${templateId}`} target="_blank" rel="noopener noreferrer">Review saved template (opens in a new tab)</a><button type="button" className="button button-secondary" onClick={()=>{if(confirmDiscardChanges(true))window.location.reload();}}>Reload saved draft</button></div>}
 </ActionForm>;
}
