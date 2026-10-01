import type { AutomationDefinition, ValidationIssue } from './model';
import { isTemporalTrigger } from './domains/tickets/temporal';
import { fieldLabel } from './ui-model';

export type PresentedIssue = { message: string; target: string; path: string };
export function presentValidationIssue(definition: AutomationDefinition, issue: ValidationIssue): PresentedIssue {
  if (issue.path.startsWith('trigger') && isTemporalTrigger(definition.trigger.type)) return { path: issue.path, target: definition.trigger.type === 'ticket.sla_breached' ? 'automation-sla-objective' : 'automation-duration', message: 'Choose an SLA requirement where applicable and a duration from 1 minute to 365 days, expressed in whole minutes.' };
  const condition = /^conditions\.children\.(\d+)/.exec(issue.path);
  const action = /^actions\.(\d+)/.exec(issue.path);
  if (condition) {
    const index = Number(condition[1]), item = definition.conditions.children[index];
    const field = item?.kind === 'condition' ? fieldLabel(item.field).toLowerCase() : 'value';
    const message = issue.code === 'invalid_value' ? `Choose a valid ${field} value${item?.kind === 'condition' && ['in','not_in'].includes(item.operator) ? ' or values' : ''} for this condition.` : 'Review the field and comparison for this condition.';
    return { path: issue.path, target: item ? `condition-section-${item.id}` : 'if-heading', message: `Condition ${index + 1}: ${message}` };
  }
  if (action) {
    const index = Number(action[1]), item = definition.actions[index];
    const messages: Record<string, string> = { assign_team: 'Select a team before saving this action.', assign_technician: 'Select an active technician before saving this action.', set_category: 'Select a category before saving this action.', set_priority: 'Select a priority before saving this action.', set_status: 'Select a status before saving this action.', add_internal_note: 'Enter an internal note of 1–20,000 characters.', send_notification: 'Select Requester or Assigned technician for the standard ticket update.' };
    return { path: issue.path, target: item ? `action-section-${item.id}` : 'then-heading', message: `Action ${index + 1}: ${issue.code === 'invalid_configuration' ? messages[item?.type] ?? 'Review the settings for this action.' : 'Review this action and its position.'}` };
  }
  const messages: Record<string, [string, string]> = {
    name: ['Enter an automation name of 1–120 characters.', 'automation-name'],
    description: ['Keep the description within 2,000 characters.', 'automation-description'],
    trigger: ['Choose an available ticket event.', 'automation-trigger'],
    conditions: ['Use up to 50 conditions. All conditions must match.', 'if-heading'],
    actions: ['Add at least one action, up to a maximum of 20.', 'add-action'],
  };
  const [message, target] = messages[issue.path] ?? ['Review this automation before saving.', 'automation-name'];
  return { path: issue.path, message, target };
}
