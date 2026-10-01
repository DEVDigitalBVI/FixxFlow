import type { DomainEvent } from '@/lib/events/model';
import type { DryRunContext, DryRunSource } from '../../dry-run-model';
import { persistenceRegistry } from '../../persistence-contract';
import { hasOnly, isRecord, isBoundedJson } from '../../values';
import { validateSnapshotField } from '../../validation';

export function validTicketSimulation(value: unknown): value is Extract<DryRunSource, { kind: 'simulated_transition' }>['after'] {
  return isBoundedJson(value) && isRecord(value) && hasOnly(value, ['status', 'priority']) && Object.keys(value).length > 0
    && Object.keys(value).every(key => validateSnapshotField(value, persistenceRegistry.field('ticket', key)!));
}
/** These envelopes are evaluation inputs, never evidence of published history. */
export function ticketDryRunEvent(context: DryRunContext, source: DryRunSource): DomainEvent {
  if (source.kind === 'retained_event') {
    if (!context.event || context.event.id !== source.eventId) throw new Error('Invalid retained context');
    return context.event;
  }
  const before = source.kind === 'simulated_transition' ? context.snapshot : null;
  const after = source.kind === 'simulated_transition' ? { ...context.snapshot, ...source.after } : context.snapshot;
  return { id: context.ticketId, schemaVersion: 1, organizationId: context.organizationId, entityType: 'ticket', entityId: context.ticketId,
    entityVersion: context.revision, type: source.kind === 'current_ticket' ? 'ticket.created' : context.definition.trigger.type,
    actorType: 'system', actorId: null, timestamp: '1970-01-01T00:00:00Z', before, after,
    changedFields: before ? Object.keys(after).filter(key => before[key] !== after[key]) : [],
    correlationId: context.ticketId, causationId: null, rootEventId: context.ticketId, depth: 0 };
}
