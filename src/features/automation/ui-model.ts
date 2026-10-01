import type { JsonValue } from '@/lib/events/model';
import type { AutomationAction, AutomationCondition, AutomationDefinition, ConditionOperator } from './model';
import { ticketAutomationDomain } from './domains/tickets/registry';
import { operatorsFor } from './registries';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';

export const automationPath = '/app/administration/automations';
export const triggerOptions = ticketAutomationDomain.triggers;
export const fieldOptions = ticketAutomationDomain.fields;
export const actionOptions = ticketAutomationDomain.actions;
export const operatorLabels: Record<ConditionOperator, string> = { equals: 'equals', not_equals: 'does not equal', contains: 'contains', not_contains: 'does not contain', is_empty: 'is empty', is_not_empty: 'is not empty', greater_than: 'is greater than', less_than: 'is less than', in: 'is one of', not_in: 'is not one of' };
export type Choice = { id: string; label: string; active: boolean; parentId?: string | null };
export type ChoicePage = { rows: Choice[]; hasNext: boolean };
export type Labels = Record<string, string>;
export const triggerLabel = (type: string) => triggerOptions.find(item => item.key === type)?.label ?? 'Ticket event';
export const fieldLabel = (field: string) => fieldOptions.find(item => item.key === field)?.label ?? 'Field';
export const actionLabel = (type: string) => actionOptions.find(item => item.key === type)?.label ?? 'Action';
export function valueLabel(value: JsonValue | undefined, labels: Labels = {}): string {
  if (value === undefined) return 'Not available';
  if (value === null || value === '') return 'Empty';
  if (Array.isArray(value)) return value.map(item => valueLabel(item, labels)).join(', ');
  const text = String(value);
  if (/^[0-9a-f-]{36}$/i.test(text)) return labels[text] ?? 'Unavailable reference';
  if (Object.hasOwn(labels,text)) return labels[text];
  if (Object.hasOwn(ticketPriorities,text)) return ticketPriorities[text as keyof typeof ticketPriorities].label;
  if (Object.hasOwn(ticketStatuses,text)) return ticketStatuses[text as keyof typeof ticketStatuses].label;
  const recipients: Record<string,string> = { requester: 'Requester', assigned_technician: 'Assigned technician', ticket_update: 'Ticket update' };
  return Object.hasOwn(recipients,text) ? recipients[text] : text;
}
export function actionDescription(action: Pick<AutomationAction, 'type' | 'configuration'>, labels: Labels = {}) {
  if (action.type === 'add_internal_note') return 'Add an internal note';
  return `${actionLabel(action.type)} → ${Object.entries(action.configuration).filter(([key]) => key !== 'template').map(([,value]) => valueLabel(value, labels)).join(', ')}`;
}
export function conditionValue(field: string, value: JsonValue | undefined, labels: Labels = {}) {
  if(fieldOptions.find(item=>item.key===field)?.value.kind==='string' && value!==undefined && value!==null) return Array.isArray(value) ? value.map(String).join(', ') : String(value);
  return valueLabel(value,labels);
}
export function conditionDescription(condition: AutomationCondition, labels: Labels = {}) { return `${fieldLabel(condition.field)} ${operatorLabels[condition.operator]}${condition.value === undefined ? '' : ` ${conditionValue(condition.field,condition.value,labels)}`}`; }
export function executionLabel(status: string, error: string | null) {
  if (error === 'retry_exhausted') return 'Retry exhausted';
  if (error === 'delivery_failed') return 'Delivery failed';
  if (error === 'stale_entity') return 'Ticket changed';
  if (error === 'processing_inactive') return 'Processing paused';
  if (error === 'rule_unavailable') return 'Rule changed or disabled';
  if (error === 'chain_limit') return 'Safety limit reached';
  return ({ running: 'Processing', succeeded: 'Completed', skipped: 'Conditions not met / skipped', failed: 'Action failed', partially_completed: 'Partially completed · action failed' } as Record<string, string>)[status] ?? 'Not run';
}
export function newDefinition(): AutomationDefinition { return { schemaVersion: 1, name: '', description: null, trigger: { type: 'ticket.created', configuration: {} }, conditions: { kind: 'group', id: 'conditions', operator: 'and', children: [] }, actions: [] }; }
export function newCondition(id: string, field = 'priority', operator?: ConditionOperator): AutomationCondition {
  const spec = fieldOptions.find(item => item.key === field)!;
  const op = operator ?? operatorsFor(spec)[0];
  const value = spec.value.kind === 'enum' ? spec.value.values[0] : '';
  return { kind: 'condition', id, field, operator: op, ...(['is_empty', 'is_not_empty'].includes(op) ? {} : { value: ['in', 'not_in'].includes(op) ? [] : value }) };
}
export function newAction(id: string, position: number, type = 'assign_team'): AutomationAction {
  const config: Record<string, JsonValue> = { assign_team: { teamId: '' }, assign_technician: { technicianId: '' }, set_priority: { priority: 'critical' }, set_status: { status: 'open' }, set_category: { categoryId: '' }, add_internal_note: { body: '' }, send_notification: { recipient: 'requester', template: 'ticket_update' } };
  return { id, position, type, configuration: config[type] as Record<string, JsonValue> };
}
export function moveAction(actions: readonly AutomationAction[], id: string, direction: -1 | 1) {
  const next = [...actions]; const index = next.findIndex(item => item.id === id), destination = index + direction;
  if (index < 0 || destination < 0 || destination >= next.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next.map((item, position) => ({ ...item, position }));
}
