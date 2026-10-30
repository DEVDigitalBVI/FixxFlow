import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Badge } from '@/components/ui/badge';
import type { TicketPriority, TicketStatus } from '@/types/database';

import { ticketPriorities, ticketStatuses } from './presentation';

type Props =
  { status: TicketStatus; priority?: never } | { priority: TicketPriority; status?: never };
/** One presentation path for ticket state and urgency; text remains the accessible label. */
export function TicketStatusBadge(props: Props) {
  const item = props.status ? ticketStatuses[props.status] : ticketPriorities[props.priority];
  return (
    <Badge tone={item.tone} className="ticket-badge">
      <NavigationIcon name={item.icon} className="badge-icon" size={14} />
      {item.label}
    </Badge>
  );
}
