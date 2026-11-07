import { randomUUID } from 'node:crypto';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionForm } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SubmissionKey } from '@/components/ui/submission-key';
import { SubmitButton } from '@/components/ui/submit-button';
import { AnnouncementAudience } from '@/features/email-announcements/audience';
import {
  announcementSent,
  campaignStatus,
  emailAnnouncementsPath,
  type AnnouncementChoices,
  type EmailAnnouncementList,
  type EmailAnnouncementReview,
} from '@/features/email-announcements/model';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { pageNumber } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

import { prepareEmailAnnouncement } from './actions';

export const metadata = { title: 'Email announcements' };
export default async function EmailAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; page?: string; sent?: string }>;
}) {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const params = await searchParams;
  if (params.draft && !isUuid(params.draft)) notFound();
  const page = pageNumber(params.page, 10000);
  const db = await createClient();
  const [history, source, members, receipt] = await Promise.all([
    db.rpc('read_email_announcements', { org: viewer.organizationId, page }),
    params.draft
      ? db.rpc('read_email_announcements', { org: viewer.organizationId, target: params.draft })
      : { data: null, error: null },
    db.rpc('email_announcement_choices', { org: viewer.organizationId }),
    params.sent && isUuid(params.sent)
      ? db.rpc('read_email_announcements', { org: viewer.organizationId, target: params.sent })
      : { data: null, error: null },
  ]);
  if (members.error || !members.data)
    throw new Error('Registered members could not load. Try again.');
  if (params.draft && !source.data && !source.error) notFound();
  if (source.error) throw new Error('The saved email could not load. Try again.');
  if (history.error || !history.data)
    throw new Error('Email announcements could not load. Try again.');
  const data = history.data as unknown as EmailAnnouncementList;
  const draft = source.data ? (source.data as unknown as EmailAnnouncementReview).campaign : null;
  const configured = Boolean(getNotificationEmailConfiguration(process.env));
  const sentReceipt =
    !receipt.error && receipt.data ? (receipt.data as unknown as EmailAnnouncementReview) : null;
  const sent =
    sentReceipt?.campaign.queued_at && announcementSent(sentReceipt.counts) ? sentReceipt : null;
  return (
    <div className="page page-narrow stack">
      <PageHeader
        title="Email announcements"
        eyebrow={viewer.organizationName}
        description="Share company announcements, guidance and updates with members who completed signup."
        back={{ href: '/app/administration#admin-support', label: 'Settings' }}
      />
      {sent && (
        <Alert tone="success" role="status">
          Announcement sent to {sent.counts.sent} {sent.counts.sent === 1 ? 'member' : 'members'}.
          {sent.counts.skipped > 0 && ` ${sent.counts.skipped} skipped.`}{' '}
          <Link href={`${emailAnnouncementsPath}/${sent.campaign.id}`}>View delivery details</Link>
        </Alert>
      )}
      {!configured && (
        <Alert tone="warning" role="status">
          Email delivery is not configured. You can prepare drafts; contact FixxFlow support before
          sending.
        </Alert>
      )}
      <section className="settings-card stack" aria-labelledby="compose-heading">
        <h2 id="compose-heading">Write an announcement</h2>
        <p className="muted">
          For all active members who completed signup, including employees, technicians and
          administrators. Pending invitations and inactive accounts are excluded. Each member
          receives a separate email.
        </p>
        <ActionForm
          key={params.draft ?? params.sent ?? 'blank'}
          action={prepareEmailAnnouncement}
          className="stack"
          pendingMessage="Preparing the draft and recipients…"
        >
          <SubmissionKey value={randomUUID()} />
          <AnnouncementAudience
            choices={members.data as unknown as AnnouncementChoices}
            defaultSelection={
              draft?.member_selection?.length
                ? ((source.data as unknown as EmailAnnouncementReview).selection ?? [])
                : null
            }
          />
          <div className="field">
            <label htmlFor="email-announcement-subject">Subject</label>
            <Input
              id="email-announcement-subject"
              name="subject"
              required
              minLength={3}
              maxLength={180}
              defaultValue={draft?.subject ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="email-announcement-body">Message</label>
            <Textarea
              id="email-announcement-body"
              name="body"
              required
              minLength={3}
              maxLength={6000}
              rows={12}
              defaultValue={draft?.body ?? ''}
              aria-describedby="email-announcement-hint"
            />
            <small id="email-announcement-hint" className="muted">
              Up to 6,000 characters. Plain text only: line breaks are preserved; Markdown and HTML
              formatting are not applied.
            </small>
          </div>
          <SubmitButton variant="primary" pendingLabel="Preparing review…">
            Review announcement &amp; recipients
          </SubmitButton>
          <p className="muted">Nothing is sent until you review and confirm on the next screen.</p>
        </ActionForm>
      </section>
      <section className="stack" aria-labelledby="email-history-heading">
        <h2 id="email-history-heading">Drafts &amp; sent announcements</h2>
        {data.campaigns.length ? (
          <ul className="stack list-none p-0">
            {data.campaigns.map((campaign) => (
              <li key={campaign.id} className="settings-card stack">
                <h3 className="[overflow-wrap:anywhere]">
                  <Link href={`${emailAnnouncementsPath}/${campaign.id}`}>{campaign.subject}</Link>
                </h3>
                <p>
                  {campaignStatus(campaign.queued_at, campaign)} · {campaign.total} members
                  {campaign.queued_at
                    ? ` · ${campaign.sent} sent · ${campaign.failed} failed · ${campaign.skipped} skipped`
                    : ''}
                </p>
                <p className="muted">
                  Created <Timestamp value={campaign.created_at} />
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            <h3>No announcements yet</h3>
            <p>Prepare your first update above, then review it before sending.</p>
          </EmptyState>
        )}
        {(page > 1 || page * 20 < data.total) && (
          <nav className="section-heading-row" aria-label="Email announcement pages">
            {page > 1 && <Link href={`${emailAnnouncementsPath}?page=${page - 1}`}>Previous</Link>}
            <span>Page {page}</span>
            {page * 20 < data.total && (
              <Link href={`${emailAnnouncementsPath}?page=${page + 1}`}>Next</Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
