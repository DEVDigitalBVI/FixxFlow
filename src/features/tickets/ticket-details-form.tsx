'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { updateTicket } from '@/app/app/tickets/actions';
import type { Database } from '@/types/database';
import { CategoryFields } from './category-fields';
import { ticketPriorities, ticketStatuses } from './presentation';
import { deadlineInputValue, TICKET_TIMEZONE_LABEL } from './deadlines';

type TicketDetails = Pick<Database['public']['Tables']['tickets']['Row'],
  'id' | 'revision' | 'status' | 'priority' | 'assigned_technician_id' | 'team_id' | 'category_id' | 'subcategory_id' | 'location_id' | 'due_at'>;

export function TicketDetailsForm({ ticket }: { ticket: TicketDetails }) {
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
        if (window.confirm('Reload the latest ticket details? This discards your unsaved changes on this page.')) window.location.reload();
      }}>Reload latest details</button>
    </div>}
    <input type="hidden" name="ticketId" value={draft.id}/>
    <input type="hidden" name="revision" value={revision}/>
    <label>Status<select className="input" name="status" defaultValue={draft.status}>{Object.entries(ticketStatuses).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
    <label>Priority<select className="input" name="priority" defaultValue={draft.priority}>{Object.entries(ticketPriorities).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
    <LookupSelect resource="technicians" name="assignedTechnicianId" label="Technician" defaultValue={draft.assigned_technician_id ?? ''}/>
    <LookupSelect resource="teams" name="teamId" label="Team" defaultValue={draft.team_id ?? ''}/>
    <CategoryFields categoryId={draft.category_id ?? ''} subcategoryId={draft.subcategory_id ?? ''}/>
    <LookupSelect resource="locations" name="locationId" label="Location" defaultValue={draft.location_id ?? ''}/>
    <label>Manual due date<input className="input" name="dueAt" type="datetime-local" defaultValue={deadlineInputValue(draft.due_at)} aria-describedby="ticket-details-due-hint"/></label>
    <small className="muted" id="ticket-details-due-hint">{TICKET_TIMEZONE_LABEL}. SLA targets are calculated separately.</small>
    <SubmitButton className="button button-primary">Save changes</SubmitButton>
  </ActionForm>;
}
