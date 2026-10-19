'use client';
import {useState} from 'react';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {Timestamp} from '@/features/timezones/provider';
import {olderStepHistory} from './checklist-actions';
import type {StepHistory} from './response-checklist';
const labels:Record<string,string>={added:'Added',edited:'Edited',reassigned:'Reassigned',acknowledged:'Acknowledged',completed:'Completed',reopened:'Reopened'};
export function ChecklistHistory({ticketId,initial,initialNames,initialHasMore}:{ticketId:string;initial:StepHistory[];initialNames:Record<string,string>;initialHasMore:boolean}) {
 const [older,setOlder]=useState<StepHistory[]|null>(null),[olderNames,setOlderNames]=useState<Record<string,string>>({}),[hasMore,setHasMore]=useState<boolean|null>(null);
 const rows=older??initial;
 const names={...olderNames,...initialNames};
 return <div className="stack">
 {!rows.length&&<p>No response history yet.</p>}
 <ol className="response-checklist">{rows.map(row=><li key={row.id}>
 <p><strong>{labels[row.action]??row.action}: {row.snapshot.title}</strong> · {names[row.actor_id]??'Staff profile unavailable'} · <Timestamp value={row.created_at}/></p>
 <details><summary>Saved details for revision {row.snapshot.revision}</summary><p className="ticket-description">{row.snapshot.instructions||'No instructions'}</p><p>Assigned to {names[row.snapshot.assignee_id]??'Staff profile unavailable'} · Deadline: <Timestamp value={row.snapshot.due_at}/></p></details>
 </li>)}</ol>
 {(hasMore??initialHasMore)&&<ActionForm protectDraft={false} action={async()=>{
  const result=await olderStepHistory(ticketId,rows.at(-1)!.id);
  if(result.error)return {error:result.error};
  setOlder(result.rows!);setOlderNames(previous=>({...previous,...result.names}));setHasMore(result.hasMore!);
  return {success:'Earlier response history loaded.'};
 }}><SubmitButton className="button button-secondary" pendingLabel="Loading history…">Load earlier changes</SubmitButton></ActionForm>}
 {older&&<button type="button" className="button button-secondary" onClick={()=>{setOlder(null);setHasMore(null);}}>Back to latest changes</button>}
 </div>;
}
