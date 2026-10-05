import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import type { FieldRegistration, ValueSchema } from '../../registries';

export const ticketPriorityValue: ValueSchema = { kind: 'enum', values: Object.keys(ticketPriorities), ordered: true };
export const ticketStatusValue: ValueSchema = { kind: 'enum', values: Object.keys(ticketStatuses) };
const reference = (key: string, label: string, resource: string, nullable = true): FieldRegistration => ({ key, label, entityType: 'ticket', nullable, value: { kind: 'reference', resource } });

export const ticketFields: readonly FieldRegistration[] = [
  { key: 'priority', label: 'Priority', entityType: 'ticket', nullable: false, value: ticketPriorityValue },
  { key: 'status', label: 'Status', entityType: 'ticket', nullable: false, value: ticketStatusValue },
  { key: 'title', label: 'Subject', entityType: 'ticket', nullable: false, value: { kind: 'string', minLength: 3, maxLength: 180 } },
  reference('category_id', 'Category', 'ticket_categories'),
  reference('subcategory_id', 'Subcategory', 'ticket_subcategories'),
  reference('assigned_technician_id', 'Assigned technician', 'active_ticket_workers'),
  reference('team_id', 'Assigned team', 'teams'),
  reference('requester_id', 'Requester', 'organization_memberships', false),
  // Enriched by the future event publisher, never inferred from the worker user.
  reference('requester_department_id', 'Requester department', 'departments'),
  reference('location_id', 'Ticket location', 'locations'),
];
