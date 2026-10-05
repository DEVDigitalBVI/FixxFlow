import type { DomainRegistration } from '../../registries';
import { ticketActions } from './actions';
import { ticketFields } from './fields';
import { ticketTriggers } from './triggers';

export const ticketAutomationDomain: DomainRegistration = { fields: ticketFields, triggers: ticketTriggers, actions: ticketActions };
