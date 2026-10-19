'use client';

import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { updateTicket } from '@/app/app/tickets/actions';
import type { Database } from '@/types/database';
import { CategoryFields } from './category-fields';
import { ticketPriorities, ticketStatuses } from './presentation';
import { DeadlineField } from './deadline-field';

type TicketDetails = Pick<Database['public']['Tables']['tickets']['Row'],
  'id' | 'revision' | 'status' | 'priority' | 'assigned_technician_id' | 'team_id' | 'category_id' | 'subcategory_id' | 'location_id' | 'due_at'>;

/** Mount the full editor only when requested, using the latest saved revision. */
export function TicketAssignmentEditor({ticket,timeZone}:{ticket:TicketDetails;timeZone:string}) {
  const [editing,setEditing]=useState(false);
  useEffect(()=>{
    const openLinkedDetails=()=>{if(window.location?.hash==='#ticket-details')setEditing(true);};
    openLinkedDetails();
    window.addEventListener('hashchange',openLinkedDetails);
    return()=>window.removeEventListener('hashchange',openLinkedDetails);
  },[]);
  return editing ? <TicketDetailsForm ticket={ticket} timeZone={timeZone}/> : <button type="button" className="button button-secondary" onClick={()=>setEditing(true)}>Choose technician or edit details</button>;
}

export function TicketDetailsForm({ ticket, timeZone }: { ticket: TicketDetails; timeZone: string }) {
  // Realtime page refreshes must never advance the draft's revision or reset its fields.
  const [draft] = useState(ticket);
  const [revision, setRevision] = useState(ticket.revision);
  const [conflicted, setConflicted] = useState(false);
  const router = useRouter();
  const stale = conflicted || ticket.revision !== revision;

  return <ActionForm id="ticket-details" className="settings-card ticket-update" action={async data => {
    const result = await updateTicket(data);
    if (result.success && result.revision !== undefined) {
      setRevision(result.revision);
      setConflicted(false);
    } else if (result.conflict) {
      setConflicted(true);
      router.refresh();
    }
    return result;
  }}>
    <h2>Ticket details</h2>
    {stale && <div className="alert ticket-edit-conflict" role="status">
      <p>The saved ticket may have changed. Your draft is still here.</p>
      <a className="button button-secondary" href={`/app/tickets/${draft.id}#ticket-details`} target="_blank" rel="noopener noreferrer">Review saved details (opens in a new tab)</a>
      <button className="button button-secondary" type="button" onClick={() => {
        if (confirmDiscardChanges(true)) window.location.reload();
      }}>Reload latest details</button>
    </div>}
    <input type="hidden" name="ticketId" value={draft.id}/>
    <input type="hidden" name="revision" value={revision}/>
    <label>Status<select className="input" name="status" defaultValue={draft.status}>{Object.entries(ticketStatuses).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
    <label>Priority<select className="input" name="priority" defaultValue={draft.priority}>{Object.entries(ticketPriorities).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
    <LookupSelect resource="technicians" name="assignedTechnicianId" label="Assigned technician" defaultValue={draft.assigned_technician_id ?? ''}/>
    <LookupSelect resource="teams" name="teamId" label="Team" defaultValue={draft.team_id ?? ''}/>
    <details className="ticket-classification"><summary>Classification &amp; deadlines</summary><div className="stack">
    <CategoryFields categoryId={draft.category_id ?? ''} subcategoryId={draft.subcategory_id ?? ''}/>
    <LookupSelect resource="locations" name="locationId" label="Location" defaultValue={draft.location_id ?? ''}/>
    <DeadlineField timeZone={timeZone} value={draft.due_at}/>
    </div></details>
    <SubmitButton className="button button-secondary">Save ticket details</SubmitButton>
  </ActionForm>;
}
