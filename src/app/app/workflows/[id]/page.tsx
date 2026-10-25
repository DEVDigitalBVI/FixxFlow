import { randomUUID } from 'node:crypto';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { RetryButton } from '@/components/ui/retry-button';
import { profileLabels } from '@/features/lookups/labels';
import { isUuid } from '@/features/tickets/communications';
import { Timestamp } from '@/features/timezones/provider';
import { DefinitionPreview } from '@/features/workflows/definition-preview';
import { ApplyTemplateForm } from '@/features/workflows/template-controls';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ticket?: string }>;
}) {
  const viewer = await requireViewer(),
    { id } = await params,
    { ticket } = await searchParams;
  if (viewer.role === 'end_user' || !isUuid(id)) notFound();
  const db = await createClient();
  const templateR = await db
    .from('workflow_templates')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('id', id)
    .eq('archived', false)
    .gt('latest_version', 0)
    .maybeSingle();
  if (templateR.error)
    return (
      <div className="page">
        <p role="alert">
          The procedure could not load. <RetryButton />
        </p>
      </div>
    );
  if (!templateR.data) notFound();
  const template = templateR.data;
  const versionR = await db
    .from('workflow_template_versions')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('template_id', id)
    .eq('version', template.latest_version)
    .maybeSingle();
  if (versionR.error || !versionR.data)
    return (
      <div className="page">
        <p role="alert">
          The published version could not load. <RetryButton />
        </p>
      </div>
    );
  const published = versionR.data;
  let application = null;
  if (ticket) {
    if (!isUuid(ticket)) notFound();
    const [ticketR, workflowR, policyR, runR] = await Promise.all([
      db
        .from('tickets')
        .select('id,title,revision,request_kind,status')
        .eq('organization_id', viewer.organizationId)
        .eq('id', ticket)
        .maybeSingle(),
      db
        .from('ticket_workflows')
        .select('*')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticket)
        .maybeSingle(),
      db
        .from('incident_escalation_policies')
        .select('*')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticket)
        .maybeSingle(),
      db
        .from('ticket_workflow_applications')
        .select('*')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticket)
        .eq('template_id', id)
        .maybeSingle(),
    ]);
    if ([ticketR, workflowR, policyR, runR].some((r) => r.error))
      application = (
        <p role="alert">
          Ticket context could not load. <RetryButton />
        </p>
      );
    else if (!ticketR.data || ticketR.data.request_kind !== 'support') notFound();
    else {
      const t = ticketR.data,
        w = workflowR.data,
        manager = !w || w.owner_id === viewer.id || viewer.role === 'administrator',
        ownerId = w?.owner_id ?? viewer.id;
      let ownerName = 'Coordinator profile unavailable',
        backupName = 'Backup profile unavailable';
      try {
        const names = await profileLabels(db, viewer.organizationId, [
          ownerId,
          policyR.data?.backup_owner_id,
        ]);
        ownerName = names.find((p) => p.user_id === ownerId)?.display_name ?? ownerName;
        backupName =
          names.find((p) => p.user_id === policyR.data?.backup_owner_id)?.display_name ??
          backupName;
      } catch {
        /* Lookup guard verifies selected people at submission. */
      }
      const mismatch = published.definition.kind === 'incident' && w?.kind !== 'incident';
      application = (
        <section className="settings-card stack">
          <h2>Apply to ticket</h2>
          <p className="ticket-description">{t.title}</p>
          <p>Coordinator: {ownerName}</p>
          {runR.data ? (
            <p>
              This procedure is already applied as version {runR.data.template_version}.{' '}
              <Link href={`/app/tickets/${ticket}#ticket-procedures`}>
                Review the applied version
              </Link>
              .
            </p>
          ) : t.status === 'resolved' || t.status === 'closed' ? (
            <p>Reopen this ticket before applying a procedure.</p>
          ) : mismatch ? (
            <p>Incident procedures require the ticket to be declared an incident first.</p>
          ) : !manager ? (
            <p>The coordinator or an administrator can apply this procedure.</p>
          ) : (
            <ApplyTemplateForm
              ticketId={ticket}
              ticketRevision={t.revision}
              templateId={id}
              version={published.version}
              token={randomUUID()}
              definition={published.definition}
              ownerId={ownerId}
              chooseOwner={!w && viewer.role === 'administrator'}
              backupId={policyR.data?.backup_owner_id}
              backupName={backupName}
            />
          )}
        </section>
      );
    }
  }
  return (
    <div className="page page-narrow">
      <PageHeader
        title={published.definition.name}
        eyebrow={`Published procedure · Version ${published.version}`}
        description={published.definition.description}
        back={{
          href: `/app/workflows${ticket ? `?ticket=${ticket}` : ''}`,
          label: 'Back to company procedures',
        }}
      />
      <section className="settings-card stack">
        <p className="muted">
          Published <Timestamp value={published.published_at} />
        </p>
        <p className="ticket-description">{published.change_note}</p>
        <DefinitionPreview definition={published.definition} />
      </section>
      {application ?? (
        <p className="muted">
          Open a ticket and choose “Apply company procedure” to use this published version.
        </p>
      )}
    </div>
  );
}
