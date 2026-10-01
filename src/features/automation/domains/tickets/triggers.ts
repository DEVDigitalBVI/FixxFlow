import type { DomainEvent } from '@/lib/events/model';
import type { TriggerRegistration } from '../../registries';
import { ticketFields } from './fields';

const changed = (event: DomainEvent, field: string) => event.before !== null && Object.hasOwn(event.before, field) && Object.hasOwn(event.after, field) && event.before[field] !== event.after[field] && event.changedFields.includes(field);
const resolved = (value: unknown) => value === 'resolved' || value === 'closed';
const assignmentFields = ['assigned_technician_id', 'team_id'];
const businessFields = [...ticketFields.map(field => field.key).filter(key => key !== 'requester_department_id'), 'description', 'due_at', 'first_response_at'];
const trigger = (key: string, label: string, fields: readonly string[], matches: TriggerRegistration['matches']): TriggerRegistration => ({ key, label, entityType: 'ticket', eventSchemaVersion: 1, configuration: {}, beforeFields: fields, afterFields: fields, matches });

export const ticketTriggers: readonly TriggerRegistration[] = [
  { ...trigger('ticket.created', 'Ticket created', [], event => event.before === null), afterFields: ['status', 'priority', 'requester_id'] },
  trigger('ticket.updated', 'Ticket updated', [], event => event.before !== null && event.changedFields.some(key => {
    if (!businessFields.includes(key)) return false;
    // The trusted publisher may omit sensitive values (e.g. description) from
    // snapshots. changedFields still records those changes without their bodies.
    return !Object.hasOwn(event.before!, key) || !Object.hasOwn(event.after, key) || changed(event, key);
  })),
  trigger('ticket.assigned', 'Ticket assigned', assignmentFields, event => assignmentFields.some(key => changed(event, key) && event.after[key] !== null)),
  trigger('ticket.status_changed', 'Ticket status changed', ['status'], event => changed(event, 'status')),
  trigger('ticket.priority_changed', 'Ticket priority changed', ['priority'], event => changed(event, 'priority')),
  trigger('ticket.resolved', 'Ticket resolved', ['status'], event => changed(event, 'status') && !resolved(event.before?.status) && resolved(event.after.status)),
];
