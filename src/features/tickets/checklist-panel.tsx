import { ChecklistHistory } from './checklist-history';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { requireViewer } from '@/lib/auth/viewer';
import { profileLabels } from '@/features/lookups/labels';
import { Timestamp } from '@/features/timezones/provider';
import { RetryButton } from '@/components/ui/retry-button';
import { ChecklistEditor, ChecklistStepAction } from './checklist-editor';
import { stepState, type IncidentStep } from './response-checklist';
export async function ChecklistPanel({organizationId,ticketId,ownerId}:{organizationId:string;ticketId:string;ownerId:string}) {
 const viewer=await requireViewer();
 if(viewer.role==='end_user'||viewer.organizationId!==organizationId)return null;
 const db=await createClient();
 const [stepsResult,approvalsResult,historyResult]=await Promise.all([
  db.from('incident_steps').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).order('created_at').order('procedure_position').order('id').limit(100),
  db.from('incident_approvals').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).is('superseded_by',null).neq('status','cancelled').not('step_id','is',null).limit(100),
  db.from('incident_step_history').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).order('id',{ascending:false}).limit(51),
 ]);
 if(stepsResult.error)return <section className="stack" aria-label="Response checklist"><h3>Response checklist</h3><p role="alert">Response steps could not load. <RetryButton/></p></section>;
 const steps=stepsResult.data??[],history=(historyResult.data??[]).slice(0,50);
 let labels=new Map<string,string>(),namesFailed=false;
 try{labels=new Map((await profileLabels(db,organizationId,[...steps.map(s=>s.assignee_id),...history.flatMap(h=>[h.actor_id,h.snapshot.assignee_id])])).map(p=>[p.user_id,p.display_name]));}catch{namesFailed=true;}
 const name=(id:string)=>labels.get(id)??'Staff profile unavailable';
 const now=new Date().getTime();
 const completed=steps.filter(s=>s.completed_at).length;
 return <section id="response-checklist" className="stack" aria-labelledby="response-checklist-heading">
  <div className="section-heading-row"><h3 id="response-checklist-heading">Response checklist</h3><span className="muted">{completed} of {steps.length} completed</span></div>
  <p className="muted">IT staff only. Assigned staff acknowledge each step before completing it. Ticket status stays separate.</p>
  {namesFailed&&<p role="alert">Staff names could not load. <RetryButton/></p>}
  {!steps.length&&<p>No response steps yet. Add the actions your team needs to follow.</p>}
  {approvalsResult.error&&<p role="alert">Step approval status could not load. Completion still requires any configured approval. <RetryButton/></p>}
  <ol className="response-checklist">{steps.map((step:IncidentStep)=>{const approval=approvalsResult.data?.find(a=>a.step_id===step.id);const blocked=Boolean(approval&&(approval.status!=='approved'||approval.step_work_version!==step.work_version));return <li className="stack" key={step.id}>
   <div className="section-heading-row"><h4>{step.title}</h4><span className={`ticket-badge tone-${step.completed_at?'success':step.due_at&&Date.parse(step.due_at)<now?'warning':'neutral'}`}>{stepState(step,now)}</span></div>
   <details open={step.completed_at?undefined:true} className="checklist-step-details"><summary>{step.completed_at?'Completed step details':'Instructions & progress'}</summary>
   {step.instructions&&<p className="ticket-description">{step.instructions}</p>}
   <p className="muted">Assigned to {name(step.assignee_id)}{viewer.id===step.assignee_id?' (you)':''} · {step.due_at?<>Due <Timestamp value={step.due_at}/></>:'No deadline'}</p>
   {step.acknowledged_at&&<p className="muted">Acknowledged <Timestamp value={step.acknowledged_at}/></p>}
   {step.completed_at&&<p className="muted">Completed <Timestamp value={step.completed_at}/></p>}
   {approval&&<p className="muted">{blocked?'Approval required for current step details':'Approved for current step details'} · <a href="#incident-approvals">Review approvals</a></p>}
   <div className="response-step-actions">
    {!step.completed_at&&viewer.id===step.assignee_id&&(!step.acknowledged_at||!blocked)&&<ChecklistStepAction ticketId={ticketId} step={step} operation={step.acknowledged_at?'complete':'acknowledge'} label={`${step.acknowledged_at?'Complete':'Acknowledge'} step: ${step.title}`}/>}
    {step.completed_at?<ChecklistStepAction ticketId={ticketId} step={step} operation="reopen" label={`Reopen step: ${step.title}`}/>:<details><summary>Edit step: {step.title}</summary><ChecklistEditor ticketId={ticketId} stepId={step.id} assigneeId={ownerId} step={step}/></details>}
   </div></details>
  </li>})}</ol>
  {steps.length<100?<details><summary>Add response step</summary><ChecklistEditor ticketId={ticketId} stepId={randomUUID()} assigneeId={ownerId}/></details>:<p>Maximum of 100 response steps reached.</p>}
  <details><summary>Response history</summary>
   {historyResult.error?<p role="alert">Response history could not load. <RetryButton/></p>:<>
   <ChecklistHistory ticketId={ticketId} initial={history} initialNames={Object.fromEntries(labels)} initialHasMore={(historyResult.data?.length??0)>50}/>
   </>}
  </details>
 </section>;
}
