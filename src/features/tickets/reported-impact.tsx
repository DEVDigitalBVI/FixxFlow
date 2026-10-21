import { isTicketImpact, ticketImpacts } from './impact';

export function ReportedImpact({value}: {value: string | null}) {
  if (!value || !isTicketImpact(value)) return null;
  const impact = ticketImpacts[value];
  return <p><strong>Reported work impact: {impact.label}</strong><br/>{impact.description}</p>;
}
