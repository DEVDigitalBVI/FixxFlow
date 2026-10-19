'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Timestamp} from '@/features/timezones/provider';
import {ActionForm} from '@/components/ui/action-form';
import {SubmitButton} from '@/components/ui/submit-button';
import {olderIncidentUpdates} from './communication-actions';
import type {DeliverySummary,IncidentBulletin} from './communications';
export function PublishedUpdates({ticketId,initial,initialHasMore,initialDelivery,deliveryError}:{ticketId:string;initial:IncidentBulletin[];initialHasMore:boolean;initialDelivery:DeliverySummary[];deliveryError:boolean}){
 const [older,setOlder]=useState<{rows:IncidentBulletin[];hasMore:boolean;delivery:DeliverySummary[];deliveryError:boolean}|null>(null);
 const page=older??{rows:initial,hasMore:initialHasMore,delivery:initialDelivery,deliveryError};
 return <div className="stack">{!page.rows.length&&<p>No approved updates yet.</p>}
 {page.deliveryError&&<p role="alert">Email delivery status could not load. Reopen the ticket to try again.</p>}
 <ul className="response-checklist">{page.rows.map(update=>{const status=page.delivery.find(s=>s.bulletin_id===update.id);return <li key={update.id} className="stack"><h4><Link href={`/app/incident-updates/${update.id}`}>{update.title}</Link></h4><p>Approved <Timestamp value={update.approved_at}/> · {update.recipient_count} selected recipients</p>
 <p className="ticket-description">{update.body}</p><p>Next update expected: <Timestamp value={update.next_update_at}/></p>
 {status&&<p className="muted">Email: {status.sent} accepted by provider · {status.pending} queued · {status.skipped} skipped · {status.failed} failed</p>}
 </li>})}</ul>
 {page.hasMore&&<ActionForm protectDraft={false} action={async()=>{
 const last=page.rows.at(-1)!;const result=await olderIncidentUpdates(ticketId,{at:last.approved_at,id:last.id});if(result.error)return {error:result.error};setOlder({rows:result.rows!,hasMore:result.hasMore!,delivery:result.delivery!,deliveryError:result.deliveryError!});return {success:'Earlier approved updates loaded.'};
 }}><SubmitButton className="button button-secondary" pendingLabel="Loading updates…">Load earlier updates</SubmitButton></ActionForm>}
 {older&&<button type="button" className="button button-secondary" onClick={()=>setOlder(null)}>Back to latest updates</button>}
 </div>;
}
