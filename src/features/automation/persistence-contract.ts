import { createAutomationRegistry, operatorsFor } from './registries';
import { ticketAutomationDomain } from './domains/tickets/registry';

// Persistence composition root. Core validators/planners remain domain agnostic.
const domains = [ticketAutomationDomain];
export const persistenceRegistry = createAutomationRegistry(domains);
/** Mirrored as trusted data in SQL; parity tests prevent silent validator drift. */
export const persistenceCatalog = {
  triggers: Object.fromEntries(domains.flatMap(domain => domain.triggers.map(trigger => [trigger.key, { entityType: trigger.entityType, configuration: trigger.configuration }]))),
  fields: Object.fromEntries(domains.flatMap(domain => domain.fields.map(field => [`${field.entityType}:${field.key}`, { value: field.value, operators: operatorsFor(field) }]))),
  actions: Object.fromEntries(domains.flatMap(domain => domain.actions.map(action => [action.key, { entityType: action.entityType, configuration: action.configuration, ...(action.triggerTypes ? { triggerTypes: action.triggerTypes } : {}) }]))),
};
