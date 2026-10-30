import Link from 'next/link';

import { ActionForm } from '@/components/ui/action-form';
import { RetryButton } from '@/components/ui/retry-button';
import { SubmitButton } from '@/components/ui/submit-button';
import { profileLabels } from '@/features/lookups/labels';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { manageIncidentFollower } from './incident-follower-actions';

/** A recipient list for approved incident messages, never a ticket-access grant. */
export async function IncidentFollowers({ ticketId }: { ticketId: string }) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return null;
  const db = await createClient();
  const group = await db
    .from('incident_stakeholder_groups')
    .select('id,revision')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId)
    .eq('is_follower_group', true)
    .eq('archived', false)
    .maybeSingle();
  const members = group.data
    ? await db
        .from('incident_stakeholder_members')
        .select('user_id')
        .eq('organization_id', viewer.organizationId)
        .eq('ticket_id', ticketId)
        .eq('group_id', group.data.id)
        .limit(100)
    : { data: [], error: null };
  let names: { user_id: string; display_name: string }[] = [];
  let failed = Boolean(group.error || members.error);
  if (!failed && members.data?.length) {
    try {
      names = await profileLabels(
        db,
        viewer.organizationId,
        members.data.map((m) => m.user_id),
      );
    } catch {
      failed = true;
    }
  }
  const revision = group.data?.revision ?? 0;
  return (
    <section className="ticket-following stack" aria-labelledby="incident-followers-heading">
      <div className="ticket-following-copy">
        <h3 id="incident-followers-heading">Incident followers</h3>
        <p id="incident-followers-hint" className="muted">
          Add a manager or another workspace member to receive approved incident updates. They won’t
          see internal notes or gain access to the ticket. Adding a follower doesn’t change the
          assignee.
        </p>
      </div>
      {failed ? (
        <p role="alert">
          The follower list couldn’t load. <RetryButton />
        </p>
      ) : (
        <>
          <ActionForm action={manageIncidentFollower} className="stack" resetOnSuccess>
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="revision" value={revision} />
            <input type="hidden" name="operation" value="add" />
            <LookupSelect
              key={revision}
              resource="people"
              name="userId"
              label="Workspace member"
              emptyLabel="Choose a workspace member"
              required
              describedBy="incident-followers-hint"
            />
            <SubmitButton variant="secondary" pendingLabel="Adding follower…">
              Add follower
            </SubmitButton>
          </ActionForm>
          <p className="muted">
            To send an update, open{' '}
            <Link href="#communication-plan">Coordinate → Stakeholder updates</Link>. The Incident
            followers audience is selected for new drafts. Public replies and status changes aren’t
            automatically shared.
          </p>
          {members.data?.length ? (
            <ul className="ticket-link-list" aria-label="Incident followers">
              {members.data.map((member) => (
                <li key={member.user_id}>
                  <span>
                    {names.find((n) => n.user_id === member.user_id)?.display_name ??
                      'Workspace member'}
                  </span>
                  <ActionForm action={manageIncidentFollower}>
                    <input type="hidden" name="ticketId" value={ticketId} />
                    <input type="hidden" name="revision" value={revision} />
                    <input type="hidden" name="operation" value="remove" />
                    <input type="hidden" name="userId" value={member.user_id} />
                    <SubmitButton variant="quiet" pendingLabel="Removing…">
                      Remove
                      <span className="sr-only">
                        {' '}
                        {names.find((n) => n.user_id === member.user_id)?.display_name ??
                          'member'}{' '}
                        from incident followers
                      </span>
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No incident followers added yet.</p>
          )}
          <p className="muted">
            Follower changes apply to new drafts. Save an existing draft again to refresh its
            audience. Removing a follower doesn’t recall approved updates.
          </p>
        </>
      )}
    </section>
  );
}
