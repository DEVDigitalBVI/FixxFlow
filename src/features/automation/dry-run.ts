import type { DomainEvent } from '@/lib/events/model';
import type { AutomationRegistry } from './registries';
import type { DryRunContext, DryRunResult, DryRunSource } from './dry-run-model';
import { planAutomation } from './planner';
import { validateDefinition } from './validation';

/** Pure projection of the real planner, with no executor or storage dependency. */
export function evaluateDryRun(context: DryRunContext, event: DomainEvent, source: DryRunSource, registry: AutomationRegistry): DryRunResult {
  const structural = validateDefinition(context.definition, registry);
  // Testing a definition intentionally ignores saved enablement and activation.
  // No synthetic identity is persisted or accepted as execution authority.
  const rule = { id: context.ruleId ?? context.ticketId, organizationId: context.organizationId, version: context.ruleVersion ?? 1,
    enabled: true, createdBy: context.ticketId, createdAt: '1970-01-01T00:00:00Z', updatedAt: '1970-01-01T00:00:00Z', definition: context.definition };
  const plan = planAutomation(rule, event, registry, context.organizationId);
  const historicalDifference = source.kind === 'retained_event' && (context.revision !== event.entityVersion || Object.keys(context.snapshot).some(key => context.snapshot[key] !== event.after[key]));
  const warnings = ['This evaluates a definition, not enablement, backlog eligibility, leases or runtime success.'];
  if (source.kind === 'current_ticket') warnings.push('Hypothetical creation using current ticket values. This does not prove a ticket-created event occurred with these values.');
  if (source.kind === 'simulated_transition') warnings.push('The selected after values are simulated. No transition occurred.');
  if (historicalDifference) warnings.push('Current ticket state differs from the retained event. Production revision protection remains in force; this is not permission to replay the event.');
  if (!context.conditionsReferencesValid) warnings.push('One or more condition references or category/subcategory relationships are unavailable in this organization.');
  if (context.ruleId && (!context.storedEnabled || context.storedArchived)) warnings.push('This stored revision is disabled or archived; only its definition is being tested.');
  let blocked = historicalDifference;
  const actions = plan.actions.map(({ action }) => {
    const valid = context.actionReferences.find(check => check.actionId === action.id)?.valid === true;
    const validation = !valid ? 'invalid' : blocked ? 'blocked' : 'valid';
    const explanation = !valid ? 'Would fail current reference validation: a target or recipient is unavailable, inactive or not permitted.'
      : blocked ? 'Would not execute after a stale context or an earlier invalid action.' : 'Current references pass. Runtime success is not guaranteed.';
    if (!valid) blocked = true;
    return { id: action.id, type: action.type, position: action.position, label: registry.action(action.type)!.label,
      configuration: Object.fromEntries(Object.entries(action.configuration).filter(([key]) => key !== 'body')), validation, explanation } as const;
  });
  return {
    sideEffectsPerformed: false, notice: 'No changes were made.',
    structuralValidation: { valid: structural.valid, issues: structural.valid ? [] : structural.issues },
    context: { source: source.kind, ticketId: context.ticketId, ticketNumber: context.ticketNumber, currentRevision: context.revision, evaluatedRevision: event.entityVersion,
      eventId: source.kind === 'retained_event' ? event.id : null, simulatedFields: source.kind === 'simulated_transition' ? Object.keys(source.after) : [],
      differsFromCurrent: historicalDifference, ruleId: context.ruleId, ruleVersion: context.ruleVersion },
    trigger: { compatible: plan.triggerCompatible, explanation: plan.triggerCompatible === true ? 'Compatible with the selected evaluation context.' : source.kind === 'current_ticket' && context.definition.trigger.type !== 'ticket.created' ? 'This trigger requires a retained event or an explicitly simulated transition.' : 'The selected context does not establish trigger compatibility.' },
    conditions: structural.valid ? structural.value.conditions.children.flatMap(condition => condition.kind === 'condition' ? [{
      id: condition.id, field: condition.field, label: registry.field(registry.trigger(structural.value.trigger.type)!.entityType, condition.field)!.label, operator: condition.operator,
      ...(condition.value !== undefined ? { expected: condition.value } : {}),
      ...(condition.field !== 'title' && Object.hasOwn(event.after, condition.field) ? { actual: event.after[condition.field] } : {}),
      actualRedacted: condition.field === 'title', status: plan.conditions.find(result => result.id === condition.id)?.status ?? 'not_evaluated',
    }] : []) : [],
    conditionsPassed: plan.status === 'ready', currentReferencesValid: context.conditionsReferencesValid && context.actionReferences.every(check => check.valid),
    actions, plannerStatus: plan.status, wouldProceed: plan.status === 'ready' && context.conditionsReferencesValid && !historicalDifference && actions.every(action => action.validation === 'valid'), warnings,
  };
}
