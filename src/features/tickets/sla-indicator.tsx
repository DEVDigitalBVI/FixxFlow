'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { NavigationIcon, type NavigationIconName } from '@/components/navigation/navigation-icon';
import { formatRelativeAge, formatTimestamp } from '@/features/timezones/model';
import { Timestamp, useTimezone } from '@/features/timezones/provider';

import { queueSlaSummary, ticketSla, type SlaResult, type SlaState, type SlaTicket } from './sla';

const Clock = createContext(0);
export function SlaClock({ initialNow, children }: { initialNow: number; children: ReactNode }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  return <Clock value={now}>{children}</Clock>;
}
/** The shared, periodically refreshed "now" from the nearest SlaClock. */
export function useSlaNow() {
  return useContext(Clock);
}
const presentation: Record<SlaState, { tone: string; icon: NavigationIconName }> = {
  on_track: { tone: 'neutral', icon: 'clock' },
  warning: { tone: 'warning', icon: 'alert' },
  breached: { tone: 'danger', icon: 'alert' },
  met: { tone: 'success', icon: 'check' },
  missed: { tone: 'danger', icon: 'alert' },
  missing: { tone: 'warning', icon: 'alert' },
  unavailable: { tone: 'neutral', icon: 'minus' },
  paused: { tone: 'neutral', icon: 'pause' },
};
function Objective({ label, result }: { label: string; result: SlaResult }) {
  const style = presentation[result.state];
  return (
    <div className={`sla-objective sla-${style.tone}`}>
      <strong>{label} SLA</strong>
      <div className="sla-label">
        <NavigationIcon name={style.icon} className="inline-icon" size={16} />
        <span>{result.label}</span>
      </div>
      {result.deadline && (
        <time className="sla-date" dateTime={result.deadline}>
          Due <Timestamp value={result.deadline} />
        </time>
      )}
      {result.completedAt && (
        <time className="sla-date" dateTime={result.completedAt}>
          Completed <Timestamp value={result.completedAt} />
        </time>
      )}
    </div>
  );
}
export function SlaIndicator({
  ticket,
  compact = false,
}: {
  ticket: SlaTicket;
  compact?: boolean;
}) {
  const now = useContext(Clock);
  const zone = useTimezone();
  const sla = ticketSla(ticket, now);
  if (compact) {
    const summary = queueSlaSummary(sla);
    const style = presentation[summary.state];
    const describe = (label: string, result: SlaResult) =>
      `${label} SLA: ${result.label}${result.deadline ? `, due ${formatTimestamp(result.deadline, zone)}` : ''}.`;
    const detail = `${describe('Response', sla.response)} ${describe('Resolution', sla.resolution)}`;
    // Queue rows show one line; the full two-objective view lives on the ticket.
    return (
      <div className={`sla-indicator sla-compact sla-${style.tone}`} title={detail}>
        <div className="sla-label" aria-hidden="true">
          <NavigationIcon name={style.icon} className="inline-icon" size={16} />
          <span>{summary.text}</span>
        </div>
        <span className="sr-only">{detail}</span>
      </div>
    );
  }
  return (
    <div className="sla-indicator">
      <span className="sr-only" role="status">
        Response SLA: {sla.response.state.replaceAll('_', ' ')}. Resolution SLA:{' '}
        {sla.resolution.state.replaceAll('_', ' ')}.
      </span>
      <Objective label="Response" result={sla.response} />
      <Objective label="Resolution" result={sla.resolution} />
    </div>
  );
}

/** "3h ago" for scanning lists, kept current by the surrounding SlaClock. */
export function RelativeAge({ value }: { value: string }) {
  const now = useContext(Clock);
  const zone = useTimezone();
  const exact = formatTimestamp(value, zone);
  return (
    <time dateTime={value} title={`${exact} (${zone})`} aria-label={`${exact} (${zone})`}>
      {formatRelativeAge(value, now, zone)}
    </time>
  );
}
