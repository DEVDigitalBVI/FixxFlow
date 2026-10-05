import { automationSafetyLimits } from '../../limits';
import type { ActionRegistration, ConfigurationSchema, ValueSchema } from '../../registries';
import { ticketPriorityValue, ticketStatusValue } from './fields';

const action = (key: string, label: string, configuration: ConfigurationSchema): ActionRegistration => ({ key, label, entityType: 'ticket', configuration });
const property = (value: ValueSchema) => ({ value });

/** Contracts only: registration does not install an executor or expose a UI. */
export const ticketActions: readonly ActionRegistration[] = [
  action('assign_technician', 'Assign technician', { technicianId: property({ kind: 'reference', resource: 'active_ticket_workers' }) }),
  action('assign_team', 'Assign team', { teamId: property({ kind: 'reference', resource: 'teams' }) }),
  action('set_priority', 'Set priority', { priority: property(ticketPriorityValue) }),
  action('set_status', 'Set status', { status: property(ticketStatusValue) }),
  action('set_category', 'Set category', { categoryId: property({ kind: 'reference', resource: 'ticket_categories' }) }),
  action('add_internal_note', 'Add internal note', { body: property({ kind: 'string', minLength: 1, maxLength: automationSafetyLimits.structural.internalNote }) }),
  action('send_notification', 'Send notification', {
    recipient: property({ kind: 'enum', values: ['requester', 'assigned_technician'] }),
    template: property({ kind: 'enum', values: ['ticket_update'] }),
  }),
];
