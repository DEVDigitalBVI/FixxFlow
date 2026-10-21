import {randomUUID} from 'node:crypto';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {profileLabels} from '@/features/lookups/labels';
import {Timestamp} from '@/features/timezones/provider';
import {RetryButton} from '@/components/ui/retry-button';
import {approvalStates,mayDecide,escalationReasons,type IncidentApproval} from './incident-control';
import {EscalationEditor,ApprovalRequestEditor,ApprovalDecisionForm,IncidentControlForm} from './incident-control-forms';
import {IncidentControlHistory} from './incident-control-history';
export async function IncidentControlPanel({organizationId,ticketId,ownerId}:{organizationId:string;ticketId:string;ownerId:string}){
 const viewer=await requireViewer();if(viewer.role==='end_user'||viewer.organizationId!==organizationId)return null;
 const db=await createClient();
 const [policyResult,pendingResult,recentResult,stepsResult,escalationResult]=await Promise.all([
 db.from('incident_escalation_policies').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).maybeSingle(),
 db.from('incident_approvals').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).eq('status','pending').is('superseded_by',null).order('due_at').order('id').limit(20),
 db.from('incident_approvals').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).neq('status','pending').is('superseded_by',null).order('decided_at',{ascending:false}).order('id',{ascending:false}).limit(10),
 db.from('incident_steps').select('id,title,work_version,completed_at').eq('organization_id',organizationId).eq('ticket_id',ticketId).order('created_at').order('id').limit(100),
 db.from('incident_escalations').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).order('id',{ascending:false}).limit(5),
 ]);
 if([policyResult,pendingResult,recentResult,stepsResult].some(r=>r.error))return <section className="stack" aria-label="Escalation and approvals"><h3>Escalation and approvals</h3><p role="alert">Workflow controls could not load. <RetryButton/></p></section>;
 const policy=policyResult.data,pending=pendingResult.data??[],recent=recentResult.data??[],steps=stepsResult.data??[];
 let names:Record<string,string>={},namesFailed=false;
 try{names=Object.fromEntries((await profileLabels(db,organizationId,[ownerId,policy?.backup_owner_id,...[...pending,...recent].flatMap(a=>[a.requested_by,a.approver_id,a.backup_approver_id,a.decision_by,a.step_snapshot?.assignee_id])])).map(p=>[p.user_id,p.display_name]));}catch{namesFailed=true;}
 const name=(id:string|null|undefined)=>id?names[id]??'Staff profile unavailable':'Not assigned';
 const manager=viewer.id===ownerId||viewer.role==='administrator',now=new Date().getTime();
 const request=(approval:IncidentApproval)=>{
 const state=approvalStates[approval.status],linked=steps.find(s=>s.id===approval.step_id),stale=Boolean(approval.status!=='cancelled'&&approval.step_id&&(!linked||linked.work_version!==approval.step_work_version));
 return <li key={approval.id} className="stack"><details><summary>{approval.title} · {state.label}{approval.status==='pending'&&Date.parse(approval.due_at)<now?' · Overdue':''}{stale?' · Fresh approval required':''}</summary><div className="stack">
 <div className="section-heading-row"><h4>{approval.title}</h4><span className={`ticket-badge tone-${state.tone}`}>{state.label}</span></div>
 <p className="ticket-description">{approval.description}</p>
 <p className="muted">Requested by {name(approval.requested_by)} · <Timestamp value={approval.requested_at}/></p>
 <p>Primary approver: {name(approval.approver_id)} · Backup: {name(approval.backup_approver_id)}</p><p>Decision due: <Timestamp value={approval.due_at}/></p>
 <p>{approval.step_id?`Linked step: ${linked?.title??'Step unavailable'}`:'Standalone decision'}</p>
 {approval.step_snapshot&&<details><summary>Review saved step details</summary><div className="stack"><h4>{approval.step_snapshot.title}</h4><p className="ticket-description">{approval.step_snapshot.instructions||'No instructions'}</p><p>Assigned to {name(approval.step_snapshot.assignee_id)} · Step deadline: <Timestamp value={approval.step_snapshot.due_at}/></p></div></details>}
 {stale&&<p className="alert" role="status">The step details changed. The coordinator or an administrator must request a fresh approval before it can be marked complete.</p>}
 {approval.decision_note&&<p className="ticket-description">Decision reason: {approval.decision_note}</p>}
 {approval.decided_at&&<p className="muted">Recorded by {name(approval.decision_by)} · <Timestamp value={approval.decided_at}/></p>}
 {!stale&&!namesFailed&&mayDecide(approval,viewer.id,now)&&<><details><summary>Approve: {approval.title}</summary><ApprovalDecisionForm ticketId={ticketId} approval={approval} operation="approve"/></details><details><summary>Reject: {approval.title}</summary><ApprovalDecisionForm ticketId={ticketId} approval={approval} operation="reject"/></details></>}
 {approval.status==='pending'&&approval.backup_approver_id===viewer.id&&Date.parse(approval.due_at)>now&&<p className="muted">You are the backup approver. You can decide after the deadline.</p>}
 {manager&&approval.status==='pending'&&<details><summary>Cancel request: {approval.title}</summary><ApprovalDecisionForm ticketId={ticketId} approval={approval} operation="cancel_approval"/></details>}
 </div></details></li>;
 };
 return <section id="incident-approvals" className="stack" aria-labelledby="incident-controls-heading">
 <h3 id="incident-controls-heading">Escalation and approvals</h3>
 <p className="muted">Review pending decisions here. Alerts and backup ownership are managed below.</p>
 {namesFailed&&<p role="alert">Staff names could not load. Decision controls are unavailable until the names can be reviewed. <RetryButton/></p>}
 <div className="stack"><h4>Approvals and decisions</h4><p className="muted">A designated approver records a reason for approval or rejection. Nobody can approve their own request. A linked step cannot be marked complete until its current work is approved.</p>
 {!pending.length&&<p>No decisions awaiting approval.</p>}<ul className="response-checklist">{pending.map(request)}</ul>
 {manager&&<details><summary>Request a decision</summary><ApprovalRequestEditor ticketId={ticketId} targetId={randomUUID()} steps={steps.filter(s=>!s.completed_at)} backupId={policy?.backup_owner_id===viewer.id?null:policy?.backup_owner_id}/></details>}
 {!!recent.length&&<details><summary>Recent decisions</summary><ul className="response-checklist">{recent.map(request)}</ul></details>}
 <details><summary>Complete approval history</summary><IncidentControlHistory ticketId={ticketId} kind="approvals"/></details>
 </div>
 <details><summary>Backup &amp; alert settings<span className="disclosure-summary">{policy?.enabled?'Alerts enabled':'Alerts off'} · Backup: {name(policy?.backup_owner_id)}</span></summary><div className="stack"><p>Backup coordinator: {name(policy?.backup_owner_id)}</p>
 <p className="muted">{policy?.enabled?`Acknowledgement due after ${policy.acknowledgement_minutes} minutes. Overdue work and communication escalate after ${policy.overdue_minutes} minutes of grace.`:'Automatic response-step and communication escalation is off. Pending approval deadlines still notify the coordinator and designated backup approver.'}</p>
 {manager&&<details><summary>Configure escalation</summary><EscalationEditor ticketId={ticketId} policy={policy}/></details>}
 {policy?.backup_owner_id===viewer.id&&<details><summary>Take over workflow coordination</summary><IncidentControlForm ticketId={ticketId} targetId={ticketId} revision={policy.revision} operation="take_over" label="Take over coordination"><label className="communication-choice"><input type="checkbox" name="confirm" value="yes" required/><span>I will become the coordinator. The previous owner becomes the backup if still active. Ticket assignment and communication ownership remain separate.</span></label></IncidentControlForm></details>}
 <details><summary>Recent escalations</summary>{escalationResult.error?<p role="alert">Escalations could not load. <RetryButton/></p>:<ul className="response-checklist">{!(escalationResult.data?.length)&&<li>No escalations recorded.</li>}{escalationResult.data?.map(e=><li key={e.id}>{escalationReasons[e.reason]} · <Timestamp value={e.created_at}/></li>)}</ul>}<IncidentControlHistory ticketId={ticketId} kind="escalations"/></details>
 <details><summary>Escalation plan and ownership history</summary><IncidentControlHistory ticketId={ticketId} kind="changes"/></details>
 </div>
 </details>

 </section>;
}
