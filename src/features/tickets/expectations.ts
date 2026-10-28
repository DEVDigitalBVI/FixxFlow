import type { TicketStatus } from '@/types/database';

import { ticketImpacts } from './impact';
import { ticketSla, type SlaTicket } from './sla';
import { fixedSlaTargets } from './sla-policy';

export const SUPPORT_HOURS = '7 AM–10 PM every day';

/** Plain-language support-time budget, e.g. "15 minutes" or "24 support hours". */
export function supportDuration(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} support hour${hours === 1 ? '' : 's'}`;
}

/** What each impact choice on the request form means for reply and resolution time. */
export function impactExpectations() {
  return Object.entries(ticketImpacts).map(([value, impact]) => {
    const target = fixedSlaTargets.find((item) => item.priority === impact.priority)!;
    return {
      value,
      label: impact.label,
      response: supportDuration(target.response),
      resolution: supportDuration(target.resolution),
    };
  });
}

export type ExpectationTone = 'neutral' | 'success' | 'warning';
export type Expectation = {
  tone: ExpectationTone;
  icon: 'clock' | 'check' | 'pause' | 'alert';
  text: string;
  /** Optional time shown after the text, rendered in the viewer's timezone. */
  at: string | null;
  /** Optional follow-up sentence shown after the time. */
  note?: string;
};

/**
 * Employee-facing reply and resolution expectations for one request.
 * Built on the same SLA evaluation staff see, but phrased as promises and
 * outcomes rather than SLA states, and never blaming the requester.
 */
export function requestExpectations(
  ticket: SlaTicket & { status: TicketStatus },
  now: number,
): { reply: Expectation | null; resolution: Expectation | null } {
  const sla = ticketSla(ticket, now);
  const done = ticket.status === 'resolved' || ticket.status === 'closed';

  let reply: Expectation | null = null;
  if (ticket.first_response_at)
    reply = { tone: 'success', icon: 'check', text: 'IT replied', at: ticket.first_response_at };
  else if (!done && sla.response.deadline)
    reply =
      sla.response.state === 'breached'
        ? {
            tone: 'warning',
            icon: 'alert',
            text: 'Our first reply is later than the target of',
            at: sla.response.deadline,
            note: 'Your request is still in the queue.',
          }
        : {
            tone: 'neutral',
            icon: 'clock',
            text: 'Expect a first reply by',
            at: sla.response.deadline,
          };

  let resolution: Expectation | null = null;
  if (done) {
    const completed = ticket.resolved_at ?? ticket.closed_at;
    resolution = {
      tone: 'success',
      icon: 'check',
      text: ticket.status === 'closed' ? 'Closed' : 'Resolved',
      at: completed,
    };
  } else if (ticket.status === 'waiting_on_user')
    resolution = {
      tone: 'neutral',
      icon: 'pause',
      text: 'IT is waiting for your reply. The resolution target is paused until you respond.',
      at: null,
    };
  else if (sla.resolution.state === 'breached')
    resolution = {
      tone: 'warning',
      icon: 'alert',
      text: 'This is taking longer than the resolution target of',
      at: sla.resolution.deadline,
      note: 'It remains open with IT.',
    };
  else if (sla.resolution.deadline)
    resolution = {
      tone: 'neutral',
      icon: 'clock',
      text:
        ticket.status === 'on_hold'
          ? 'On hold with IT. We still aim to resolve this by'
          : 'We aim to resolve this by',
      at: sla.resolution.deadline,
    };
  return { reply, resolution };
}
