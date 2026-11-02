import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionForm } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import { SubmitButton } from '@/components/ui/submit-button';
import { AnnouncementDeliveryProgress } from '@/features/email-announcements/delivery-progress';
import {
  deliveryLabels,
  emailAnnouncementsPath,
  type EmailAnnouncementReview,
} from '@/features/email-announcements/model';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { requireWorkspaceAccess } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { pageNumber } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

import { queueEmailAnnouncement } from '../actions';

export const metadata = { title: 'Review email announcement' };
export default async function EmailAnnouncementReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ announcementId: string }>;
  searchParams: Promise<{ page?: string; sending?: string }>;
}) {
  const viewer = await requireWorkspaceAccess();
  if (viewer.role !== 'administrator') notFound();
  const { announcementId } = await params;
  if (!isUuid(announcementId)) notFound();
  const filters = await searchParams;
  const page = pageNumber(filters.page, 10000);
  const db = await createClient();
  const { data, error } = await db.rpc('read_email_announcements', {
    org: viewer.organizationId,
    target: announcementId,
    page,
  });
  if (error) throw new Error('Email review could not load. Try again.');
  if (!data) notFound();
  const { campaign, counts, recipients } = data as unknown as EmailAnnouncementReview;
  const queued = Boolean(campaign.queued_at);
  const configured = Boolean(getNotificationEmailConfiguration(process.env));
  return (
    <div className="page page-narrow stack">
      <PageHeader
        title={queued ? 'Announcement progress' : 'Review email announcement'}
        description={
          queued
            ? 'Track the email you queued for members.'
            : 'Check the message and recipient list before sending.'
        }
        back={{ href: emailAnnouncementsPath, label: 'Email announcements' }}
      />
      <section className="settings-card stack" aria-labelledby="email-preview-heading">
        <h2 id="email-preview-heading">{campaign.subject}</h2>
        <p className="muted">
          Recipients:{' '}
          {campaign.member_selection?.length ? 'Specific members' : 'All registered members'}
        </p>
        <p className="muted">Email subject: FixxFlow: {campaign.subject}</p>
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{campaign.body}</p>
        <p className="muted">
          The email uses FixxFlow branding and includes an Open FixxFlow link.
        </p>
      </section>
      {queued ? (
        <AnnouncementDeliveryProgress
          announcementId={announcementId}
          queuedAt={campaign.queued_at!}
          initialCounts={counts}
          returnWhenSent={filters.sending === '1'}
        />
      ) : (
        <Alert tone="info" role="status">
          Draft only — no emails have been sent. Recipients were selected when you prepared this
          draft. New members require a new draft; members who become ineligible will be skipped.
        </Alert>
      )}
      <section className="settings-card stack" aria-labelledby="email-recipients-heading">
        <h2 id="email-recipients-heading">Recipients ({counts.total})</h2>
        <ul className="stack list-none p-0">
          {recipients.map((recipient) => (
            <li key={recipient.user_id} className="section-heading-row">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <strong>{recipient.display_name}</strong>
                <p className="muted">{recipient.email}</p>
              </div>
              <span>{queued ? deliveryLabels[recipient.status] : 'Selected'}</span>
            </li>
          ))}
        </ul>
        {!recipients.length && <p>No recipients on this page.</p>}
        {(page > 1 || page * 50 < counts.total) && (
          <nav className="section-heading-row" aria-label="Recipient pages">
            {page > 1 && (
              <Link href={`${emailAnnouncementsPath}/${announcementId}?page=${page - 1}`}>
                Previous
              </Link>
            )}
            <span>Page {page}</span>
            {page * 50 < counts.total && (
              <Link href={`${emailAnnouncementsPath}/${announcementId}?page=${page + 1}`}>
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
      {!queued && (
        <section className="settings-card stack" aria-labelledby="send-email-heading">
          <h2 id="send-email-heading">Send this announcement</h2>
          {!configured && (
            <Alert tone="warning" role="status">
              Email delivery is not configured. Your draft is saved; contact FixxFlow support before
              sending.
            </Alert>
          )}
          {counts.total === 0 && (
            <Alert tone="warning" role="status">
              No recipients remain in this draft. Prepare a new draft to review the current members.
            </Alert>
          )}
          <ActionForm
            action={queueEmailAnnouncement}
            className="stack"
            protectDraft={false}
            pendingMessage="Queueing email announcements…"
          >
            <input type="hidden" name="announcementId" value={announcementId} />
            <label className="check-field">
              <Checkbox name="confirm" value="yes" required />I reviewed the message and recipients
              and want to send this email.
            </label>
            <SubmitButton
              variant="primary"
              disabled={!configured || counts.total === 0}
              pendingLabel="Queueing…"
            >
              Send announcement to {counts.total} {counts.total === 1 ? 'member' : 'members'}
            </SubmitButton>
          </ActionForm>
          <Link
            className={buttonVariants({ variant: 'secondary' })}
            href={`${emailAnnouncementsPath}?draft=${announcementId}#compose-heading`}
          >
            Edit as a new draft
          </Link>
          <Link href={emailAnnouncementsPath}>Keep as draft</Link>
        </section>
      )}
    </div>
  );
}
