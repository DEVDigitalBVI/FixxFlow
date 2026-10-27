import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { RetryButton } from '@/components/ui/retry-button';
import { loadQueueCounts, type QueueCounts } from '@/features/tickets/queue-counts';
import type { Viewer } from '@/lib/auth/viewer';

const shortcuts = [
  {
    key: 'mine',
    href: '/app/tickets?view=mine',
    title: 'My assigned tickets',
    description: 'Continue the work you own',
    empty: 'No tickets assigned to you',
  },
  {
    key: 'unassigned',
    href: '/app/tickets?view=unassigned',
    title: 'Unassigned tickets',
    description: 'Find requests that need an owner',
    empty: 'Every ticket has an owner',
  },
  {
    key: 'overdue',
    href: '/app/tickets?sla=breached',
    title: 'Overdue tickets',
    description: 'Review requests past their SLA',
    empty: 'No breached SLA targets',
  },
  {
    key: 'chats',
    href: '/app/chat?view=unassigned',
    title: 'Incoming chats',
    description: 'Pick up a new conversation',
    empty: 'No chats waiting for an owner',
  },
] as const;
export function QueueShortcuts({
  counts,
  loading = false,
}: {
  counts: QueueCounts;
  loading?: boolean;
}) {
  return (
    <div aria-busy={loading}>
      <nav className="overview-queues" aria-label="Support shortcuts">
        {shortcuts.map((item) => (
          <Link key={item.key} href={item.href} className="overview-queue">
            <span className="overview-queue-copy">
              <strong>{item.title}</strong>
              <span>{counts[item.key] === 0 ? item.empty : item.description}</span>
            </span>
            <span className="overview-queue-count">
              {loading ? 'Loading…' : (counts[item.key] ?? 'Unavailable')}
            </span>
            <NavigationIcon name="arrowRight" className="overview-queue-arrow" />
          </Link>
        ))}
      </nav>
      {!loading && Object.values(counts).some((value) => value === null) && (
        <p className="muted" role="status">
          Some queue counts could not load. <RetryButton />
        </p>
      )}
    </div>
  );
}
export async function WorkQueues({
  viewer,
}: {
  viewer: Pick<Viewer, 'id' | 'organizationId' | 'role'>;
}) {
  return <QueueShortcuts counts={await loadQueueCounts(viewer)} />;
}
