import { HistoryBrowser, type HistoryFilters } from '@/features/conversations/history-browser';

export default async function ChatHistory({ params, searchParams }: {
  params: Promise<{ conversationId: string }>; searchParams: Promise<HistoryFilters>;
}) {
  return <HistoryBrowser kind="chat" id={(await params).conversationId} filters={await searchParams} />;
}
