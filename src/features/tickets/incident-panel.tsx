import { IncidentControlPanel } from './incident-control-panel';
import { CommunicationPanel } from './communication-panel';
import { ChecklistPanel } from './checklist-panel';
import { createClient } from '@/lib/supabase/server';
import { profileLabels } from '@/features/lookups/labels';
import { RetryButton } from '@/components/ui/retry-button';
import { IncidentEditor } from './incident-editor';
import { incidentSeverities } from './incidents';

/** Rendered only after TicketDetail's employee branch has returned. */
export async function IncidentPanel({ organizationId,ticketId,revision,ownerId }: { organizationId: string; ticketId: string; revision: number; ownerId: string }) {
  const db = await createClient();
  const {data,error} = await db.from('ticket_incidents').select('*').eq('organization_id',organizationId).eq('ticket_id',ticketId).maybeSingle();
  if (error) return <section className="settings-card" aria-label="Incident coordination"><p role="alert">Incident details could not load. <RetryButton/></p></section>;
  if (!data) return <section className="settings-card"><details><summary>Declare an incident</summary><p className="muted">Use an incident for a broader disruption. Existing ownership, replies, attachments, priority and status remain on this ticket.</p><IncidentEditor ticketId={ticketId} ticketRevision={revision} incident={null} ownerId={ownerId}/></details></section>;
  let ownerName = 'Owner profile unavailable';
  let ownerError = false;
  try { ownerName = (await profileLabels(db,organizationId,[data.owner_id]))[0]?.display_name ?? ownerName; }
  catch { ownerError = true; }
  const severity = incidentSeverities[data.severity];
  return <section id="incident-summary" className="settings-card stack" aria-labelledby="incident-summary-heading">
    <div className="section-heading-row"><h2 id="incident-summary-heading">Incident summary</h2><span className={`ticket-badge tone-${severity.tone}`}>Severity: {severity.label}</span></div>
    <p className="muted">IT staff only · Severity describes impact; ticket priority controls urgency.</p>
    {ownerError && <p role="alert">The incident owner name could not load. <RetryButton/></p>}
    <dl className="incident-summary"><div><dt>Incident owner</dt><dd>{ownerName}</dd></div><div><dt>Affected services</dt><dd>{data.affected_services.length ? data.affected_services.join(', ') : 'Not recorded'}</dd></div><div><dt>Affected locations</dt><dd>{data.affected_locations.length ? data.affected_locations.join(', ') : 'Not recorded'}</dd></div></dl>
    <div><h3>Business impact</h3><p className="ticket-description">{data.business_impact}</p></div>
    <details><summary>Edit incident details</summary><IncidentEditor ticketId={ticketId} ticketRevision={revision} incident={data} ownerId={ownerId}/></details>
    <IncidentControlPanel organizationId={organizationId} ticketId={ticketId} ownerId={data.owner_id}/>
    <CommunicationPanel organizationId={organizationId} ticketId={ticketId} ownerId={data.owner_id}/>
    <ChecklistPanel organizationId={organizationId} ticketId={ticketId} ownerId={data.owner_id}/>
  </section>;
}
