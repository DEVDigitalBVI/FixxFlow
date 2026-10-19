'use client';
import {useState} from 'react';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {Timestamp} from '@/features/timezones/provider';
import {incidentControlHistory} from './incident-control-actions';
import type {ControlHistoryRow} from './incident-control';
export function IncidentControlHistory({ticketId,kind}:{ticketId:string;kind:'escalations'|'approvals'|'changes'}){
 const [page,setPage]=useState<{rows:ControlHistoryRow[];hasMore:boolean}|null>(null);
 return <div className="stack">
 {page&&!page.rows.length&&<p>No recorded changes yet.</p>}
 <ol className="response-checklist">{page?.rows.map(row=><li key={row.id}><p><strong>{row.title}</strong> · <Timestamp value={row.at}/></p><p className="ticket-description">{row.description}</p></li>)}</ol>
 {(!page||page.hasMore)&&<ActionForm protectDraft={false} action={async()=>{const result=await incidentControlHistory(ticketId,kind,page?.rows.at(-1)?.id);if(result.error)return {error:result.error};setPage({rows:result.rows!,hasMore:result.hasMore!});return {success:'Workflow history loaded.'};}}><SubmitButton className="button button-secondary" pendingLabel="Loading history…">{page?'Load earlier history':'Load history'}</SubmitButton></ActionForm>}
 {page&&<button className="button button-secondary" type="button" onClick={()=>setPage(null)}>Back to latest history</button>}
 </div>;
}
