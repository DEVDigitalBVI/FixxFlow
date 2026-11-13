import type { ReactNode } from 'react';

import type { bulkUpdateTickets } from '@/app/app/tickets/actions';
import type { Viewer } from '@/lib/auth/viewer';
import type { TicketStatus } from '@/types/database';

import type { loadTicketQueue, TicketQueueFilters } from './data';

type QueueData = Awaited<ReturnType<typeof loadTicketQueue>>;
export type TicketQueueViewProps = QueueData & {
  viewer: Viewer;
  filters: TicketQueueFilters;
  returnTo: string;
  detailHref: (id: string) => string;
  pageHref: (page: number) => string;
  tickets: NonNullable<QueueData['rows']> | undefined;
  renderedAt: number;
  searchSummary: string;
  hasMore: boolean;
  pagination: ReactNode;
  usage: ReactNode;
  relatedArticles: ReactNode;
  names: Map<string, string>;
  teamNames: Map<string, string>;
};
export type StaffQueueViewProps = TicketQueueViewProps & {
  clearHref: string;
  withoutFilter: (key: keyof TicketQueueFilters) => string;
  appliedFilters: ReadonlyArray<{
    key: keyof TicketQueueFilters;
    label: string | null | undefined;
  }>;
  activeFilterCount: number;
  bulkUpdateTickets: typeof bulkUpdateTickets;
};
export const active: TicketStatus[] = ['new', 'open', 'in_progress', 'waiting_on_user', 'on_hold'];
export const sortOptions = {
  updated: 'Recently updated',
  oldest: 'Oldest update',
  newest: 'Newest created',
  due: 'Manual due date',
  sla: 'SLA due soon',
  priority: 'Highest priority',
} as const;
