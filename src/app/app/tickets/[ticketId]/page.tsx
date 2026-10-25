import { TicketDetail } from '@/features/tickets/ticket-detail';

type Props = {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ error?: string; success?: string; returnTo?: string }>;
};
export default async function TicketPage({ params, searchParams }: Props) {
  return <TicketDetail ticketId={(await params).ticketId} message={await searchParams} />;
}
