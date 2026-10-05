import type { AutomationDefinition } from './model';
import { newAction, newCondition, newDefinition } from './ui-model';

/** Presentation-only blueprints. Empty required values are deliberate draft inputs,
 * never placeholder tenant IDs. The ordinary validator gates both saving and testing.
 */
export type AutomationTemplate = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: 'Routing' | 'Triage' | 'Communication';
  readonly useCase: string;
  readonly guidance: string;
  readonly definition: AutomationDefinition;
};
const draft = (name: string, field: string, type: string, configuration?: AutomationDefinition['actions'][number]['configuration']): AutomationDefinition => ({
  ...newDefinition(), name,
  conditions: { kind: 'group', id: 'conditions', operator: 'and', children: [newCondition('match', field)] },
  actions: [{ ...newAction('first-action', 0, type), ...(configuration ? { configuration } : {}) }],
});
export const automationTemplates: readonly AutomationTemplate[] = [
  { id: 'critical-ticket-assignment', name: 'Critical Ticket Assignment', category: 'Routing',
    description: 'Route critical tickets to the appropriate team.', useCase: 'Keep urgent work with the team responsible for triage.',
    guidance: 'Select a team. Review whether category routing already covers these tickets.',
    definition: { ...draft('Critical Ticket Assignment', 'priority', 'assign_team'), conditions: { kind: 'group', id: 'conditions', operator: 'and', children: [{ ...newCondition('match'), value: 'critical' }] } } },
  { id: 'category-based-routing', name: 'Category Based Routing', category: 'Routing',
    description: 'Send tickets in a selected category to the right team.', useCase: 'Route a specific kind of request consistently.',
    guidance: 'Select a category and a team. Existing category routing still applies before automation.',
    definition: draft('Category Based Routing', 'category_id', 'assign_team') },
  { id: 'technician-assignment', name: 'Technician Assignment', category: 'Routing',
    description: 'Assign matching tickets to a selected technician.', useCase: 'Send specialist requests to a designated person.',
    guidance: 'Choose a category or change the condition, then select an active technician.',
    definition: draft('Technician Assignment', 'category_id', 'assign_technician') },
  { id: 'priority-adjustment', name: 'Priority Adjustment', category: 'Triage',
    description: 'Set priority when selected conditions match.', useCase: 'Give a category of requests a consistent priority.',
    guidance: 'Choose a category or change the condition, then select a priority. Priority changes recalculate existing SLA targets.',
    definition: draft('Priority Adjustment', 'category_id', 'set_priority', { priority: '' }) },
  { id: 'internal-triage-note', name: 'Add Internal Triage Note', category: 'Triage',
    description: 'Add internal guidance to matching tickets.', useCase: 'Give technicians a consistent triage checklist.',
    guidance: 'Choose a condition and enter the note. Internal notes are visible to staff, not requesters.',
    definition: draft('Add Internal Triage Note', 'category_id', 'add_internal_note') },
  { id: 'requester-notification', name: 'Requester Notification', category: 'Communication',
    description: 'Send the standard ticket update to the requester.', useCase: 'Notify the requester when a critical ticket is created.',
    guidance: 'Review the condition and existing ticket notifications to avoid unnecessary messages. The standard message cannot be customized here.',
    definition: { ...draft('Requester Notification', 'priority', 'send_notification'), conditions: { kind: 'group', id: 'conditions', operator: 'and', children: [{ ...newCondition('match'), value: 'critical' }] } } },
];
export function templateDraft(id: string): { definition: AutomationDefinition; enabled: false } {
  const template = automationTemplates.find(item => item.id === id);
  if (!template) throw new Error('Choose an available automation template.');
  return { definition: structuredClone(template.definition), enabled: false };
}
