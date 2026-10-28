import Link from 'next/link';

import { Timestamp } from '@/features/timezones/provider';

export function ChatLifecycleNotice({
  open,
  warningAt,
  warningDueAt,
  closedAt,
  summary,
}: {
  open: boolean;
  warningAt?: string | null;
  warningDueAt?: string | null;
  closedAt?: string | null;
  summary?: string | null;
}) {
  if (!open && closedAt && summary)
    return (
      <section className="settings-card chat-closure-summary" aria-labelledby="chat-summary-title">
        <h2 id="chat-summary-title">Chat summary</h2>
        <p>{summary}</p>
        <Link className="button button-secondary" href="/app/chat?start=1">
          Start a new chat
        </Link>
      </section>
    );
  if (open && warningAt)
    return (
      <p className="alert alert-warning" role="status">
        IT has replied.{' '}
        {warningDueAt ? (
          <>
            Reply before <Timestamp value={warningDueAt} /> to keep this chat open.
          </>
        ) : (
          'Reply to keep this chat open.'
        )}{' '}
        Support hours are 7 AM–10 PM, every day in the workspace timezone.
      </p>
    );
  return null;
}
