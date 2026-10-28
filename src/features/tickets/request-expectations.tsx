'use client';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Timestamp } from '@/features/timezones/provider';
import type { TicketStatus } from '@/types/database';

import { requestExpectations, SUPPORT_HOURS, type Expectation } from './expectations';
import type { SlaTicket } from './sla';
import { useSlaNow } from './sla-indicator';

function Row({ term, item }: { term: string; item: Expectation }) {
  return (
    <div className={`request-expectation sla-${item.tone}`}>
      <dt>{term}</dt>
      <dd>
        <NavigationIcon name={item.icon} className="inline-icon" size={16} />
        <span>
          {item.text}
          {item.at && (
            <>
              {' '}
              <time dateTime={item.at}>
                <Timestamp value={item.at} />
              </time>
            </>
          )}
          {item.note && `. ${item.note}`}
        </span>
      </dd>
    </div>
  );
}

/** Employee-facing "What to expect" summary. Render inside an SlaClock. */
export function RequestExpectations({ ticket }: { ticket: SlaTicket & { status: TicketStatus } }) {
  const now = useSlaNow();
  const { reply, resolution } = requestExpectations(ticket, now);
  if (!reply && !resolution) return null;
  const active = ticket.status !== 'resolved' && ticket.status !== 'closed';
  return (
    <section
      className="portal-detail-card request-expectations"
      aria-labelledby="expectations-heading"
    >
      <h2 id="expectations-heading">What to expect</h2>
      <dl>
        {reply && <Row term="First reply" item={reply} />}
        {resolution && <Row term="Resolution" item={resolution} />}
      </dl>
      {active && ticket.sla_timezone && (
        <details className="request-expectations-policy">
          <summary>How these times work</summary>
          <p className="muted">
            Targets count support hours, {SUPPORT_HOURS} ({ticket.sla_timezone}). IT may adjust the
            urgency after review, which updates these times.
          </p>
        </details>
      )}
    </section>
  );
}
