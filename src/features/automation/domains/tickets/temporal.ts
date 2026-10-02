import { automationSafetyLimits } from '../../limits';
import type { EntitySnapshot, JsonValue } from '@/lib/events/model';
import type { AutomationTrigger } from '../../model';
import type { ConfigurationSchema, TriggerRegistration } from '../../registries';
import { isRecord, isTimestamp, isUuid, matchesConfiguration } from '../../values';

export const temporalTypes = ['ticket.unassigned_duration_reached', 'ticket.waiting_on_user_duration_reached', 'ticket.open_duration_reached', 'ticket.sla_approaching', 'ticket.sla_breached'] as const;
export const isTemporalTrigger = (type: string) => (temporalTypes as readonly string[]).includes(type);
export const durationSchema = { value: { kind: 'number', integer: true, min: 1, max: automationSafetyLimits.structural.durationMinutes } } as const;
export function temporalConfiguration(type: string): ConfigurationSchema {
  return { ...(type !== 'ticket.sla_breached' ? { durationMinutes: durationSchema } : {}), ...(type.startsWith('ticket.sla_') ? { objective: { value: { kind: 'enum', values: ['response', 'resolution'] } as const } } : {}) };
}
export function defaultTemporalConfiguration(type: string): Record<string, JsonValue> {
  return isTemporalTrigger(type) ? { ...(type !== 'ticket.sla_breached' ? { durationMinutes: 30 } : {}), ...(type.startsWith('ticket.sla_') ? { objective: 'resolution' } : {}) } : {};
}
// PostgreSQL timestamps can retain six fractional digits. Preserve them when
// checking boundaries so a dry run cannot round a not-yet-due threshold forward.
function timestampMicros(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-])/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}
function microsIso(value: bigint): string {
  const remainder = ((value % 1000n) + 1000n) % 1000n;
  return new Date(Number((value - remainder) / 1000n)).toISOString().replace('Z', `${String(remainder).padStart(3, '0')}Z`);
}
export type TemporalEvaluation = { known: boolean; met: boolean; anchor: string | null; thresholdAt: string | null; episode: string | null; durationMinutes: number | null; elapsedMinutes: number | null; evaluatedAt: string; explanation: string };
/** Pure ticket adapter: server supplies time; no browser clock or scheduler writes. */
export function evaluateTemporal(trigger: AutomationTrigger, snapshot: EntitySnapshot, evaluatedAt: string): TemporalEvaluation {
  const result: TemporalEvaluation = { known: false, met: false, anchor: null, thresholdAt: null, episode: null, durationMinutes: typeof trigger.configuration.durationMinutes === 'number' ? trigger.configuration.durationMinutes : null, elapsedMinutes: null, evaluatedAt, explanation: 'The authoritative time anchor is unknown.' };
  if (!isTemporalTrigger(trigger.type) || !matchesConfiguration(trigger.configuration, temporalConfiguration(trigger.type)) || !isTimestamp(evaluatedAt)) return { ...result, explanation: 'Invalid temporal context.' };
  if (['resolved', 'closed'].includes(String(snapshot.status))) return { ...result, explanation: 'Resolved and closed tickets are excluded.' };
  let anchor: unknown, episode: unknown;
  switch (trigger.type) {
    case 'ticket.unassigned_duration_reached':
      if (snapshot.assigned_technician_id !== null) return { ...result, explanation: 'The ticket has an assigned technician.' };
      anchor = snapshot.unassigned_since; episode = snapshot.unassigned_episode_id; break;
    case 'ticket.waiting_on_user_duration_reached':
      if (snapshot.status !== 'waiting_on_user') return { ...result, explanation: 'The ticket is not waiting on the user.' };
      anchor = snapshot.waiting_on_user_since; episode = snapshot.waiting_on_user_episode_id; break;
    case 'ticket.open_duration_reached': anchor = snapshot.created_at; episode = 'created'; break;
    default: {
      const response = trigger.configuration.objective === 'response';
      if (snapshot[response ? 'first_response_at' : 'resolved_at'] != null || snapshot.closed_at != null) return { ...result, explanation: 'This SLA requirement is already satisfied.' };
      anchor = snapshot[response ? 'response_sla_due_at' : 'resolution_sla_due_at']; episode = anchor;
    }
  }
  if (!isTimestamp(anchor) || typeof episode !== 'string' || (trigger.type.includes('_duration_reached') && trigger.type !== 'ticket.open_duration_reached' && !isUuid(episode))) return result;
  const now = timestampMicros(evaluatedAt), start = timestampMicros(anchor), offset = BigInt(result.durationMinutes ?? 0) * 60000000n;
  const threshold = start + (trigger.type === 'ticket.sla_approaching' ? -offset : trigger.type === 'ticket.sla_breached' ? 0n : offset);
  const met = now >= threshold && (trigger.type !== 'ticket.sla_approaching' || now < start);
  return { ...result, known: true, met, anchor, episode, thresholdAt: microsIso(threshold), elapsedMinutes: Number(now - start) / 60000000, explanation: met ? 'The elapsed-time threshold is met.' : 'The threshold is not currently met.' };
}
const labels = ['Ticket has been unassigned for', 'Ticket has been waiting on user for', 'Ticket has been open for', 'SLA is due within', 'SLA is breached'];
export const temporalTriggers: readonly TriggerRegistration[] = temporalTypes.map((key, index) => ({
  key, label: labels[index], entityType: 'ticket', eventSchemaVersion: 1, configuration: temporalConfiguration(key), beforeFields: [], afterFields: ['status', 'priority', 'requester_id'],
  matches(event, configuration) {
    const metadata = event.after.temporal;
    if (!isRecord(metadata) || !isRecord(metadata.configuration)) return false;
    const saved = metadata.configuration;
    if (!matchesConfiguration(saved, temporalConfiguration(key)) || Object.keys(configuration).some(name => configuration[name] !== saved[name])) return false;
    return evaluateTemporal({ type: key, configuration }, event.after, event.timestamp).met;
  },
}));
