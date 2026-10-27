import Link from 'next/link';

import { RetryButton } from '@/components/ui/retry-button';
import { profileLabels } from '@/features/lookups/labels';
import { ChecklistPanel } from '@/features/tickets/checklist-panel';
import { CommunicationPanel } from '@/features/tickets/communication-panel';
import { IncidentControlPanel } from '@/features/tickets/incident-control-panel';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { DefinitionPreview } from './definition-preview';
import { workflowKinds } from './model';

export async function TicketProcedures({
  organizationId,
  ticketId,
}: {
  organizationId: string;
  ticketId: string;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || viewer.organizationId !== organizationId) return null;
  const db = await createClient();
  const [workflowR, runsR] = await Promise.all([
    db
      .from('ticket_workflows')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .maybeSingle(),
    db
      .from('ticket_workflow_applications')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .order('applied_at')
      .order('id')
      .limit(5),
  ]);
  if (workflowR.error || runsR.error)
    return (
      <section className="settings-card">
        <p role="alert">
          Ticket procedures could not load. <RetryButton />
        </p>
      </section>
    );
  const workflow = workflowR.data,
    runs = runsR.data ?? [];
  if (!workflow)
    return (
      <section id="ticket-procedures" className="settings-card">
        <details>
          <summary>Company procedures</summary>
          <p className="muted">
            Apply a published maintenance or general procedure to add repeatable response work.
            Incident procedures require an incident declaration.
          </p>
          <Link className="button button-secondary" href={`/app/workflows?ticket=${ticketId}`}>
            Apply procedure
          </Link>
        </details>
      </section>
    );
  let names: Record<string, string> = {},
    nameError = false;
  try {
    names = Object.fromEntries(
      (
        await profileLabels(db, organizationId, [
          workflow.owner_id,
          ...runs.flatMap((r) => [
            r.applied_by,
            r.assignment_snapshot.owner_id,
            r.assignment_snapshot.backup_id,
            r.assignment_snapshot.approver_id,
          ]),
        ])
      ).map((p) => [p.user_id, p.display_name]),
    );
  } catch {
    nameError = true;
  }
  const name = (id: string | null | undefined) =>
    id ? (names[id] ?? 'Staff profile unavailable') : 'Not assigned';
  return (
    <section
      id="ticket-procedures"
      className="settings-card ticket-procedures"
      aria-labelledby="ticket-procedure-heading"
    >
      <div className="section-heading-row">
        <h2 id="ticket-procedure-heading">
          {workflow.kind === 'incident' ? 'Applied procedures' : workflowKinds[workflow.kind]}
        </h2>
        {runs.length < 5 && (
          <Link className="button button-secondary" href={`/app/workflows?ticket=${ticketId}`}>
            Apply procedure
          </Link>
        )}
      </div>
      {workflow.kind !== 'incident' && <p>Coordinator: {name(workflow.owner_id)}</p>}
      {nameError && (
        <p role="alert">
          Staff names could not load. <RetryButton />
        </p>
      )}
      {!runs.length && <p className="muted">No procedure applied.</p>}
      <ul className="response-checklist">
        {runs.map((run) => (
          <li key={run.id}>
            <details>
              <summary>
                {run.definition_snapshot.name} · Applied version {run.template_version}
              </summary>
              <div className="stack">
                <p className="muted">
                  Applied by {name(run.applied_by)} · <Timestamp value={run.applied_at} />
                </p>
                <p>
                  Original coordinator: {name(run.assignment_snapshot.owner_id)} · Backup:{' '}
                  {name(run.assignment_snapshot.backup_id)} · Primary approver:{' '}
                  {name(run.assignment_snapshot.approver_id)}
                </p>
                <p className="muted">
                  This saved version stays with this ticket. Current progress and any later changes
                  appear in the response checklist and history.
                </p>
                <DefinitionPreview definition={run.definition_snapshot} />
              </div>
            </details>
            {run.definition_snapshot.communication.guidance && (
              <details>
                <summary>Communication guidance: {run.definition_snapshot.name}</summary>
                <p className="ticket-description">
                  {run.definition_snapshot.communication.guidance}
                </p>
              </details>
            )}
          </li>
        ))}
      </ul>
      {workflow.kind !== 'incident' && (
        <>
          <ChecklistPanel
            organizationId={organizationId}
            ticketId={ticketId}
            ownerId={workflow.owner_id}
          />
          <IncidentControlPanel
            organizationId={organizationId}
            ticketId={ticketId}
            ownerId={workflow.owner_id}
          />
          <CommunicationPanel
            organizationId={organizationId}
            ticketId={ticketId}
            ownerId={workflow.owner_id}
          />
        </>
      )}
    </section>
  );
}
