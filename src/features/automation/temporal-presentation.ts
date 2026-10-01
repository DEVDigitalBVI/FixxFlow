import type { AutomationTrigger } from './model';
import { isTemporalTrigger } from './domains/tickets/temporal';

export function durationLabel(minutes: number): string {
  const [value, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}
export function temporalTriggerPhrase(trigger: AutomationTrigger): string | null {
  if (!isTemporalTrigger(trigger.type)) return null;
  const duration = typeof trigger.configuration.durationMinutes === 'number' ? durationLabel(trigger.configuration.durationMinutes) : 'a selected duration';
  const objective = trigger.configuration.objective === 'response' ? 'first-response' : 'resolution';
  switch (trigger.type) {
    case 'ticket.unassigned_duration_reached': return `a ticket has had no assigned technician for ${duration}`;
    case 'ticket.waiting_on_user_duration_reached': return `a ticket has been waiting on the requester for ${duration}`;
    case 'ticket.open_duration_reached': return `an unresolved ticket reaches ${duration} since creation`;
    case 'ticket.sla_approaching': return `a ${objective} SLA is due within ${duration}`;
    default: return `a ${objective} SLA is breached`;
  }
}
