import { HistoryBrowser, type HistoryFilters } from '@/features/conversations/history-browser';

export default async function TicketHistory({ params, searchParams }: {
  params: Promise<{ ticketId: string }>; searchParams: Promise<HistoryFilters>;
}) {
  return <HistoryBrowser kind="ticket" id={(await params).ticketId} filters={await searchParams} />;
}
