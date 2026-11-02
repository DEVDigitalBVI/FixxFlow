'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Timestamp } from '@/features/timezones/provider';

import {
  announcementSent,
  campaignStatus,
  emailAnnouncementsPath,
  type EmailCounts,
} from './model';

export function AnnouncementDeliveryProgress({
  announcementId,
  queuedAt,
  initialCounts,
  returnWhenSent,
}: {
  announcementId: string;
  queuedAt: string;
  initialCounts: EmailCounts;
  returnWhenSent: boolean;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState(initialCounts);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    let running = false;
    let returning = false;
    let remaining = initialCounts.pending;
    let controller: AbortController | null = null;
    const finish = (next: EmailCounts) => {
      if (returnWhenSent && announcementSent(next) && !returning) {
        returning = true;
        router.replace(`${emailAnnouncementsPath}?sent=${announcementId}`);
      }
    };
    finish(initialCounts);
    const check = async () => {
      if (!active || running || returning || document.visibilityState === 'hidden') return;
      running = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      setPending(true);
      try {
        const response = await fetch(`${emailAnnouncementsPath}/${announcementId}/status`, {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw Error('Status unavailable');
        const result = await response.json();
        const next = result.counts as EmailCounts;
        if (
          !next ||
          !['total', 'sent', 'pending', 'failed', 'skipped'].every(
            (key) =>
              Number.isSafeInteger(next[key as keyof EmailCounts]) &&
              next[key as keyof EmailCounts] >= 0,
          ) ||
          next.sent + next.pending + next.failed + next.skipped !== next.total
        )
          throw Error('Invalid status');
        if (active) {
          remaining = next.pending;
          setCounts(next);
          setFailed(false);
          if (result.queued === true) finish(next);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        running = false;
        if (active) setPending(false);
      }
    };
    refresh.current = check;
    const visible = () => {
      if (remaining > 0 && document.visibilityState !== 'hidden') void check();
    };
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => {
      if (remaining > 0) void check();
    }, 10_000);
    if (initialCounts.pending > 0) void check();
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [announcementId, initialCounts, returnWhenSent, router]);
  return (
    <section className="settings-card stack" aria-labelledby="email-progress-heading">
      <h2 id="email-progress-heading">{campaignStatus(queuedAt, counts)}</h2>
      <p>
        Queued <Timestamp value={queuedAt} />
      </p>
      <p role="status">
        {counts.sent} sent · {counts.pending} pending · {counts.failed} failed · {counts.skipped}{' '}
        skipped
      </p>
      <p className="muted">
        Sending runs in the background. Temporary failures retry automatically. Sent means the email
        provider accepted the message. Members who lose access or change email address before
        processing are skipped.
      </p>
      {returnWhenSent && counts.pending > 0 && (
        <p className="muted">You’ll return to compose automatically once sending succeeds.</p>
      )}
      {counts.failed > 0 && (
        <Alert tone="warning" role="status">
          Some emails could not be sent after retrying. Contact FixxFlow support before preparing
          another email for those members.
        </Alert>
      )}
      {counts.pending === 0 && counts.sent === 0 && counts.failed === 0 && (
        <Alert tone="warning" role="status">
          No emails were sent. The recipients are no longer eligible.
        </Alert>
      )}
      {failed && (
        <Alert tone="error" role="alert">
          Delivery status could not refresh. You’ll stay here until sending is confirmed. Try again.
        </Alert>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => void refresh.current()}
      >
        Refresh progress
      </Button>
    </section>
  );
}
