import { temporalTriggerPhrase } from './temporal-presentation';
import type { AutomationDefinition } from './model';
import { actionDescription, conditionDescription, triggerPhrase, type Labels } from './ui-model';

/** Derived presentation only: never persisted or used to decide execution. */
export function automationSummary(definition: AutomationDefinition, labels: Labels = {}): string {
  const trigger = temporalTriggerPhrase(definition.trigger) ?? triggerPhrase(definition.trigger.type);
  const conditions = definition.conditions.children.map(item => item.kind === 'condition' ? conditionDescription(item, labels) : 'review the condition group');
  const actions = [...definition.actions].sort((a, b) => a.position - b.position).map(item => actionDescription(item, labels));
  return `When ${trigger}, ${conditions.length ? `if ${conditions.join(' and ')}, ` : ''}${actions.length ? actions.map((text, index) => index === 0 ? text[0].toLowerCase() + text.slice(1) : text).join(', then ') : 'add an action'}.`;
}
