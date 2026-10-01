import type { DomainEvent, JsonValue } from '@/lib/events/model';
import type { ConditionOperator } from './model';

export type ValueSchema =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly ordered?: boolean }
  | { readonly kind: 'reference'; readonly resource: string }
  | { readonly kind: 'string'; readonly minLength?: number; readonly maxLength: number }
  | { readonly kind: 'number'; readonly min?: number; readonly max?: number; readonly integer?: boolean }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'string_set'; readonly maxItems: number; readonly itemMaxLength: number };
export type ConfigurationSchema = Readonly<Record<string, { readonly value: ValueSchema; readonly optional?: boolean }>>;
export type FieldRegistration = { readonly key: string; readonly entityType: string; readonly label: string; readonly value: ValueSchema; readonly nullable: boolean };
export type TriggerRegistration = {
  readonly key: string;
  readonly entityType: string;
  readonly label: string;
  readonly eventSchemaVersion: number;
  readonly configuration: ConfigurationSchema;
  readonly beforeFields: readonly string[];
  readonly afterFields: readonly string[];
  /** Trusted adapter code, never obtained from a saved definition. Must be pure. */
  readonly matches: (event: DomainEvent, configuration: Readonly<Record<string, JsonValue>>) => boolean;
};
export type ActionRegistration = {
  readonly key: string;
  readonly entityType: string;
  readonly label: string;
  readonly configuration: ConfigurationSchema;
  readonly triggerTypes?: readonly string[];
};
export type DomainRegistration = {
  readonly fields: readonly FieldRegistration[];
  readonly triggers: readonly TriggerRegistration[];
  readonly actions: readonly ActionRegistration[];
};
export type AutomationRegistry = {
  readonly field: (entityType: string, key: string) => FieldRegistration | undefined;
  readonly trigger: (key: string) => TriggerRegistration | undefined;
  readonly action: (key: string) => ActionRegistration | undefined;
};

function freezeSchema(schema: ValueSchema): ValueSchema {
  return Object.freeze(schema.kind === 'enum' ? { ...schema, values: Object.freeze([...schema.values]) } : { ...schema });
}
function freezeConfiguration(schema: ConfigurationSchema): ConfigurationSchema {
  return Object.freeze(Object.fromEntries(Object.entries(schema).map(([key, property]) => [key, Object.freeze({ ...property, value: freezeSchema(property.value) })])));
}

/** Construct once from trusted application adapters. Duplicate registrations fail fast. */
export function createAutomationRegistry(domains: readonly DomainRegistration[]): AutomationRegistry {
  const fields = new Map<string, FieldRegistration>();
  const triggers = new Map<string, TriggerRegistration>();
  const actions = new Map<string, ActionRegistration>();
  function add<T>(map: Map<string, T>, key: string, value: T) {
    if (map.has(key)) throw new Error(`Duplicate automation registration: ${key}`);
    map.set(key, value);
  }
  for (const domain of domains) {
    for (const field of domain.fields) add(fields, JSON.stringify([field.entityType, field.key]), Object.freeze({ ...field, value: freezeSchema(field.value) }));
    for (const trigger of domain.triggers) add(triggers, trigger.key, Object.freeze({ ...trigger, configuration: freezeConfiguration(trigger.configuration), beforeFields: Object.freeze([...trigger.beforeFields]), afterFields: Object.freeze([...trigger.afterFields]) }));
    for (const action of domain.actions) add(actions, action.key, Object.freeze({ ...action, configuration: freezeConfiguration(action.configuration), ...(action.triggerTypes ? { triggerTypes: Object.freeze([...action.triggerTypes]) } : {}) }));
  }
  for (const trigger of triggers.values()) {
    if (![...trigger.beforeFields, ...trigger.afterFields].every(key => fields.has(JSON.stringify([trigger.entityType, key])))) throw new Error(`Unknown trigger field: ${trigger.key}`);
  }
  for (const action of actions.values()) {
    if (action.triggerTypes?.some(key => triggers.get(key)?.entityType !== action.entityType)) throw new Error(`Incompatible action registration: ${action.key}`);
  }
  return Object.freeze({
    field: (entityType: string, key: string) => fields.get(JSON.stringify([entityType, key])),
    trigger: (key: string) => triggers.get(key),
    action: (key: string) => actions.get(key),
  });
}

export function operatorsFor(field: FieldRegistration): readonly ConditionOperator[] {
  const operators: ConditionOperator[] = field.value.kind === 'string_set' ? ['contains', 'not_contains'] : ['equals', 'not_equals', 'in', 'not_in'];
  if (field.nullable || field.value.kind === 'string' || field.value.kind === 'string_set') operators.push('is_empty', 'is_not_empty');
  if (field.value.kind === 'string') operators.push('contains', 'not_contains');
  if (field.value.kind === 'number' || (field.value.kind === 'enum' && field.value.ordered)) operators.push('greater_than', 'less_than');
  return operators;
}
