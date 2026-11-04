import Link from 'next/link';

import { ActionForm } from '@/components/ui/action-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { RetryButton } from '@/components/ui/retry-button';
import { SubmitButton } from '@/components/ui/submit-button';
import { createClient } from '@/lib/supabase/server';

import { saveSharedIncident } from './actions';
import { isSharedFeed } from './model';

export async function IncidentSharingPanel({
  organizationId,
  ticketId,
  eligible,
}: {
  organizationId: string;
  ticketId: string;
  eligible: boolean;
}) {
  const db = await createClient();
  const { data, error } = await db.rpc('shared_incidents', {
    org: organizationId,
    ticket: ticketId,
  });
  if (error || !isSharedFeed(data))
    return (
      <section className="settings-card stack">
        <h2>Shared incident summary</h2>
        <p role="alert">Sharing settings could not load.</p>
        <RetryButton />
      </section>
    );
  const summary = data.rows[0];
  if (!eligible && !summary) return null;
  return (
    <section className="settings-card stack" aria-labelledby="incident-sharing-title">
      <h2 id="incident-sharing-title">Shared incident summary</h2>
      <p className="muted">
        {summary?.published && eligible
          ? 'Published to employees with Shared incidents access.'
          : 'Private until explicitly published.'}{' '}
        Share only information suitable for these viewers.
      </p>
      {!eligible && (
        <p role="status">
          This ticket no longer qualifies for sharing and is hidden from employee viewers.
        </p>
      )}
      <details>
        <summary>{summary ? 'Edit shared summary' : 'Prepare shared summary'}</summary>
        <ActionForm action={saveSharedIncident} className="stack" key={summary?.revision ?? 0}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="revision" value={summary?.revision ?? 0} />
          <label className="field">
            Shared title
            <Input name="title" required maxLength={200} defaultValue={summary?.title ?? ''} />
          </label>
          <label className="field">
            Shared overview
            <Textarea
              name="overview"
              required
              maxLength={4000}
              rows={4}
              defaultValue={summary?.overview ?? ''}
            />
          </label>
          <label className="field">
            Resolution summary
            <Textarea
              name="resolution"
              maxLength={4000}
              rows={5}
              defaultValue={summary?.resolution ?? ''}
            />
          </label>
          <p className="muted">
            Explain what happened, the fix and any follow-up. Ticket descriptions, replies, internal
            notes and files are never copied here.
          </p>
          <label className="check-field">
            <Checkbox
              name="published"
              defaultChecked={!!summary?.published && eligible}
              disabled={!eligible}
            />
            Publish to shared incidents
          </label>
          <p className="muted">Clear Publish and save to withdraw access.</p>
          <SubmitButton variant="secondary">Save shared summary</SubmitButton>
        </ActionForm>
      </details>
      {summary?.published && eligible && (
        <Link href={`/app/shared-incidents/${ticketId}`}>View published summary</Link>
      )}
    </section>
  );
}
