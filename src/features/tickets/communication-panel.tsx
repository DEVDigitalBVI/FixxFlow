import { randomUUID } from 'node:crypto';

import Link from 'next/link';

import { RetryButton } from '@/components/ui/retry-button';
import { profileLabels } from '@/features/lookups/labels';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import {
  AddStakeholder,
  CommunicationForm,
  DraftEditor,
  GroupNameForm,
  PlanEditor,
} from './communication-forms';
import { PublishedUpdates } from './published-updates';
import { ServiceAnnouncementPanel } from './service-announcement-panel';

export async function CommunicationPanel({
  organizationId,
  ticketId,
  ownerId,
}: {
  organizationId: string;
  ticketId: string;
  ownerId: string;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || viewer.organizationId !== organizationId) return null;
  const db = await createClient();
  const [planResult, groupResult, draftResult, bulletinResult] = await Promise.all([
    db
      .from('incident_communication_plans')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .maybeSingle(),
    db
      .from('incident_stakeholder_groups')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .eq('archived', false)
      .order('created_at')
      .order('id')
      .limit(20),
    db
      .from('incident_update_drafts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .eq('status', 'draft')
      .order('created_at')
      .order('id')
      .limit(20),
    db
      .from('incident_bulletins')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('ticket_id', ticketId)
      .order('approved_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(21),
  ]);
  const memberResult = groupResult.data?.length
    ? await db
        .from('incident_stakeholder_members')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('ticket_id', ticketId)
        .in(
          'group_id',
          groupResult.data.map((g) => g.id),
        )
        .limit(2000)
    : { data: [], error: null };
  if ([planResult, groupResult, memberResult, draftResult].some((r) => r.error))
    return (
      <section className="stack" aria-label="Communication plan">
        <h3>Communication plan</h3>
        <p role="alert">
          The communication plan could not load. <RetryButton />
        </p>
      </section>
    );
  const plan = planResult.data,
    groups = groupResult.data ?? [],
    members = memberResult.data ?? [],
    drafts = draftResult.data ?? [],
    bulletins = (bulletinResult.data ?? []).slice(0, 20);
  const ids = [
    ...new Set([
      plan?.owner_id ?? ownerId,
      ...members.map((m) => m.user_id),
      ...drafts.flatMap((d) => [d.created_by, ...d.recipient_ids]),
      ...bulletins.map((b) => b.approved_by),
    ]),
  ];
  const names: Record<string, string> = {};
  let namesFailed = false;
  try {
    const chunks = [];
    for (let start = 0; start < ids.length; start += 200)
      chunks.push(ids.slice(start, start + 200));
    for (const batch of await Promise.all(
      chunks.map((chunk) => profileLabels(db, organizationId, chunk)),
    ))
      for (const p of batch) names[p.user_id] = p.display_name;
  } catch {
    namesFailed = true;
  }
  const name = (id: string) => names[id] ?? 'Staff or member profile unavailable';
  const canApprove = viewer.id === ownerId || viewer.role === 'administrator';
  const due = plan?.next_update_at && Date.parse(plan.next_update_at) < new Date().getTime();
  const delivery = bulletins.length
    ? await db.rpc('incident_delivery_summary', {
        org: organizationId,
        ticket: ticketId,
        bulletins: bulletins.map((b) => b.id),
      })
    : { data: [], error: null };
  return (
    <section id="communication-plan" className="stack" aria-labelledby="communication-plan-heading">
      <ServiceAnnouncementPanel
        organizationId={organizationId}
        ticketId={ticketId}
        ownerId={ownerId}
      />
      <div className="section-heading-row">
        <h3 id="communication-plan-heading">Stakeholder updates</h3>
        {due && <span className="ticket-badge tone-warning">Update due</span>}
      </div>
      <p className="muted">
        Prepare an update, review its audience, then ask the coordinator or an administrator to
        approve and send it.
      </p>
      {namesFailed && (
        <p role="alert">
          Member names could not load. Approval is unavailable until names can be reviewed.{' '}
          <RetryButton />
        </p>
      )}
      <p>
        Communication owner: {name(plan?.owner_id ?? ownerId)} · Next update:{' '}
        <Timestamp value={plan?.next_update_at ?? null} />
      </p>
      {plan?.reminded_at && (
        <p className="muted">
          Reminder recorded <Timestamp value={plan.reminded_at} />
        </p>
      )}
      <div className="stack">
        <h4>Update drafts</h4>
        {!drafts.length && <p className="muted">No drafts awaiting approval.</p>}
        <ul className="response-checklist">
          {drafts.map((draft) => (
            <li key={draft.id} className="stack">
              <details>
                <summary>
                  {draft.title} · {draft.recipient_ids.length} recipients
                </summary>
                <div className="stack">
                  <p className="muted">
                    Saved revision {draft.revision} · Prepared by {name(draft.created_by)} ·{' '}
                    <Timestamp value={draft.updated_at} />
                  </p>
                  <h4>{draft.title}</h4>
                  <p className="ticket-description">{draft.body}</p>
                  <p>
                    Next update expected: <Timestamp value={draft.next_update_at} />
                  </p>
                  <p>Saved groups: {draft.group_names.join(', ')}</p>
                  <details>
                    <summary>Review saved recipients ({draft.recipient_ids.length})</summary>
                    <ul>
                      {draft.recipient_ids.map((id) => (
                        <li key={id}>{name(id)}</li>
                      ))}
                    </ul>
                  </details>
                  {canApprove &&
                    !namesFailed &&
                    draft.recipient_ids.every((id) => Boolean(names[id])) && (
                      <CommunicationForm
                        ticketId={ticketId}
                        targetId={draft.id}
                        revision={draft.revision}
                        operation="publish"
                        label="Approve and send update"
                      >
                        <label className="communication-choice">
                          <input type="checkbox" name="confirm" value="yes" required />
                          <span>
                            I approve this saved message and its {draft.recipient_ids.length} saved
                            recipients. Send notifications and email updates.
                          </span>
                        </label>
                      </CommunicationForm>
                    )}
                  {draft.recipient_ids.some((id) => !names[id]) && (
                    <p role="alert">
                      Some saved recipient profiles are unavailable. Restore their profiles or save
                      the draft with an updated audience before approval.
                    </p>
                  )}
                  {!canApprove && (
                    <p className="muted">
                      Ready for the coordinator or an administrator to approve.
                    </p>
                  )}
                  <details>
                    <summary>Edit draft: {draft.title}</summary>
                    <DraftEditor
                      ticketId={ticketId}
                      targetId={draft.id}
                      groups={groups}
                      draft={draft}
                    />
                  </details>
                  <details>
                    <summary>Discard draft: {draft.title}</summary>
                    <p>
                      This removes the draft from pending approval. It cannot be sent afterward.
                    </p>
                    <CommunicationForm
                      ticketId={ticketId}
                      targetId={draft.id}
                      revision={draft.revision}
                      operation="discard_draft"
                      label="Discard draft"
                    />
                  </details>
                </div>
              </details>
            </li>
          ))}
        </ul>
        {drafts.length < 20 && (
          <details>
            <summary>Prepare stakeholder update</summary>
            <DraftEditor ticketId={ticketId} targetId={randomUUID()} groups={groups} />
          </details>
        )}
      </div>
      <details>
        <summary>Edit communication plan</summary>
        <PlanEditor ticketId={ticketId} ownerId={ownerId} plan={plan} />
      </details>
      <details>
        <summary>Stakeholder groups ({groups.length})</summary>
        <p className="muted">
          Company members only. Up to 20 active groups and 100 members per group. Group changes
          apply to new drafts; save an existing draft again to update its audience.
        </p>
        {!groups.length && <p>No stakeholder groups yet.</p>}
        <ul className="response-checklist">
          {groups.map((group) => {
            const roster = members.filter((m) => m.group_id === group.id);
            return (
              <li key={group.id} className="stack">
                <details>
                  <summary>
                    {group.name} · {roster.length} members
                  </summary>
                  <ul className="response-checklist">
                    {roster.map((member) => (
                      <li key={member.user_id} className="section-heading-row">
                        <span>{name(member.user_id)}</span>
                        <CommunicationForm
                          ticketId={ticketId}
                          targetId={group.id}
                          revision={group.revision}
                          liveRevision
                          operation="remove_member"
                          label={`Remove ${name(member.user_id)} from ${group.name}`}
                        >
                          <input type="hidden" name="userId" value={member.user_id} />
                        </CommunicationForm>
                      </li>
                    ))}
                  </ul>
                  {roster.length < 100 && <AddStakeholder ticketId={ticketId} group={group} />}
                  <details>
                    <summary>Rename {group.name}</summary>
                    <GroupNameForm ticketId={ticketId} targetId={group.id} group={group} />
                  </details>
                  <details>
                    <summary>Archive {group.name}</summary>
                    <p>
                      Future drafts cannot select this group. Saved draft audiences and published
                      updates are retained.
                    </p>
                    <CommunicationForm
                      ticketId={ticketId}
                      targetId={group.id}
                      revision={group.revision}
                      liveRevision
                      operation="archive_group"
                      label={`Archive group: ${group.name}`}
                    />
                  </details>
                </details>
              </li>
            );
          })}
        </ul>
        {groups.length < 20 && (
          <details>
            <summary>Create stakeholder group</summary>
            <GroupNameForm ticketId={ticketId} targetId={randomUUID()} />
          </details>
        )}
      </details>
      {bulletins[0] && (
        <p className="muted">
          Latest approved update:{' '}
          <Link href={`/app/incident-updates/${bulletins[0].id}`}>{bulletins[0].title}</Link> ·{' '}
          <Timestamp value={bulletins[0].approved_at} />
        </p>
      )}
      <details>
        <summary>Approved updates and delivery</summary>
        {bulletinResult.error ? (
          <p role="alert">
            Approved updates could not load. <RetryButton />
          </p>
        ) : (
          <PublishedUpdates
            ticketId={ticketId}
            initial={bulletins}
            initialHasMore={(bulletinResult.data?.length ?? 0) > 20}
            initialDelivery={delivery.data ?? []}
            deliveryError={Boolean(delivery.error)}
          />
        )}
      </details>
      <p className="muted">
        Recipients can open approved updates from{' '}
        <Link href="/app/notifications">Notifications</Link>. Recipients who have already read an
        update may not receive an email.
      </p>
    </section>
  );
}
