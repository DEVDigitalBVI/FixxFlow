import type { JsonValue } from '@/lib/events/model';
import type { AutomationDefinition, ConditionOperator } from './model';
import { persistenceRegistry } from './persistence-contract';
import { validateDefinition, automationLimits } from './validation';
import { copyJson, hasOnly, isBoundedJson, isRecord, isTimestamp, isUuid, UUID_PATTERN } from './values';
import type { Choice, Labels } from './ui-model';

export const portableLimits = { bytes: 512 * 1024, references: 200, rules: 1, depth: 12 } as const;
export const portableResources = {
  technician: 'active_ticket_workers', team: 'teams', category: 'ticket_categories',
  subcategory: 'ticket_subcategories', requester: 'organization_memberships', department: 'departments', location: 'locations',
} as const;
export type PortableKind = keyof typeof portableResources;
export type PortableReference = { key: string; kind: PortableKind; sourceLabel: string };
type PortableCondition = { field: string; operator: ConditionOperator; value?: JsonValue };
type PortableAction = { type: string; configuration: Record<string, JsonValue> };
export type PortablePackage = {
  format: 'fixxflow-automation'; version: 1; exportedAt: string;
  references: PortableReference[];
  rules: [{ name: string; description: string | null; trigger: AutomationDefinition['trigger'];
    conditions: { operator: 'and'; items: PortableCondition[] }; actions: PortableAction[] }];
};
export class PortabilityError extends Error {}
function reject(message: string): never { throw new PortabilityError(message); }
// Explicitly reviewed export surface. Future secret-backed capabilities must opt in
// with a safe projection, never inherit export support from a registry addition.
const actions = ['assign_technician', 'assign_team', 'set_priority', 'set_status', 'set_category', 'add_internal_note', 'send_notification'];
const actionKeys: Record<string, string[]> = { assign_technician: ['technicianId'], assign_team: ['teamId'], set_priority: ['priority'], set_status: ['status'], set_category: ['categoryId'], add_internal_note: ['body'], send_notification: ['recipient', 'template'] };
const triggers = ['ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.status_changed', 'ticket.priority_changed', 'ticket.resolved', 'ticket.unassigned_duration_reached', 'ticket.waiting_on_user_duration_reached', 'ticket.open_duration_reached', 'ticket.sla_approaching', 'ticket.sla_breached'];
const fields = ['priority', 'status', 'title', 'category_id', 'subcategory_id', 'assigned_technician_id', 'team_id', 'requester_id', 'requester_department_id', 'location_id'];
const kindFor = (resource: string): PortableKind => {
  const entry = Object.entries(portableResources).find(([, value]) => value === resource);
  return entry ? entry[0] as PortableKind : reject('This reference type is not portable yet.');
};
const placeholder = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
function structure(value: unknown, keys: string[], message: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnly(value, keys)) reject(message);
}

/** A lexical depth guard precedes JSON.parse; strings/escapes never execute. */
export function parsePortablePackage(text: string): PortablePackage {
  if (text.length > portableLimits.bytes || new TextEncoder().encode(text).length > portableLimits.bytes) reject('Choose a file smaller than 512 KB.');
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { if (++depth > portableLimits.depth) reject('This package is nested too deeply.'); }
    else if (char === '}' || char === ']') depth--;
  }
  let input: unknown;
  try { input = JSON.parse(text); } catch { return reject('This file is not valid JSON. Choose a FixxFlow Automation package.'); }
  return validatePortablePackage(input);
}

export function validatePortablePackage(input: unknown): PortablePackage {
  if (!isBoundedJson(input)) reject('This package exceeds the supported size or nesting limits.');
  structure(input, ['format', 'version', 'exportedAt', 'references', 'rules'], 'Unrecognized package fields. Export configuration only.');
  if (input.format !== 'fixxflow-automation') reject('Choose a FixxFlow Automation package.');
  if (input.version !== 1) reject(typeof input.version === 'number' && input.version > 1 ? 'This package was created by a newer version of FixxFlow and cannot be imported here.' : 'A supported package version is required (version 1).');
  if (!isTimestamp(input.exportedAt)) reject('The package export date is invalid.');
  if (!Array.isArray(input.references) || input.references.length > portableLimits.references) reject('A package supports up to 200 organization references.');
  const keys = new Set<string>();
  for (const ref of input.references) {
    structure(ref, ['key', 'kind', 'sourceLabel'], 'Invalid organization reference.');
    if (typeof ref.key !== 'string' || !/^ref-[1-9][0-9]{0,2}$/.test(ref.key) || keys.has(ref.key) || typeof ref.kind !== 'string' || !Object.hasOwn(portableResources, ref.kind) || typeof ref.sourceLabel !== 'string' || !ref.sourceLabel.trim() || ref.sourceLabel.length > 180 || isUuid(ref.sourceLabel)) reject('Organization references need a unique package key, supported type and display name.');
    keys.add(ref.key);
  }
  if (!Array.isArray(input.rules) || input.rules.length !== portableLimits.rules) reject('Import one automation per package.');
  const rule = input.rules[0];
  structure(rule, ['name', 'description', 'trigger', 'conditions', 'actions'], 'Unrecognized automation fields. Runtime data cannot be imported.');
  structure(rule.trigger, ['type', 'configuration'], 'Choose a supported trigger.');
  if (typeof rule.trigger.type !== 'string' || !triggers.includes(rule.trigger.type)) reject('This package uses an unsupported trigger.');
  const triggerKeys = rule.trigger.type.endsWith('_duration_reached') ? ['durationMinutes'] : rule.trigger.type === 'ticket.sla_approaching' ? ['durationMinutes', 'objective'] : rule.trigger.type === 'ticket.sla_breached' ? ['objective'] : [];
  structure(rule.trigger.configuration, triggerKeys, 'Unrecognized trigger settings.');
  structure(rule.conditions, ['operator', 'items'], 'Invalid conditions.');
  if (rule.conditions.operator !== 'and' || !Array.isArray(rule.conditions.items) || rule.conditions.items.length > automationLimits.conditions) reject('Use up to 50 conditions, all of which must match.');
  for (const condition of rule.conditions.items) {
    structure(condition, ['field', 'operator', 'value'], 'Unrecognized condition fields.');
    if (typeof condition.field !== 'string' || !fields.includes(condition.field)) reject('This package uses an unsupported condition field.');
  }
  if (!Array.isArray(rule.actions) || rule.actions.length < 1 || rule.actions.length > automationLimits.actions) reject('Use between 1 and 20 actions.');
  for (const action of rule.actions) {
    structure(action, ['type', 'configuration'], 'Unrecognized action fields.');
    if (typeof action.type !== 'string' || !actions.includes(action.type)) reject('This package uses an unsupported action.');
    structure(action.configuration, actionKeys[action.type], 'Unrecognized action settings.');
  }
  const pkg = copyJson(input) as PortablePackage;
  materialize(pkg); // Shared engine validation after reference-shape validation.
  return pkg;
}

/** Preview uses inert synthetic IDs only; never send a preview to persistence. */
function materialize(pkg: PortablePackage, mapping?: Readonly<Record<string, string>>): AutomationDefinition {
  const used = new Set<string>();
  const resolve = (value: JsonValue, resource: string): JsonValue => {
    if (Array.isArray(value)) return value.map(item => resolve(item, resource));
    if (!isRecord(value) || !hasOnly(value, ['reference']) || typeof value.reference !== 'string') return reject('Map organization values using portable references, not source identifiers.');
    const index = pkg.references.findIndex(ref => ref.key === value.reference && ref.kind === kindFor(resource));
    if (index < 0) return reject('An organization reference is missing or has the wrong type.');
    const ref = pkg.references[index]; used.add(ref.key);
    if (!mapping) return placeholder(index);
    const id = Object.hasOwn(mapping, ref.key) ? mapping[ref.key] : undefined;
    if (!isUuid(id)) return reject(`Select a destination ${ref.kind} for “${ref.sourceLabel}” before continuing.`);
    return id;
  };
  const rule = pkg.rules[0];
  const definition = { schemaVersion: 1, name: rule.name, description: rule.description, trigger: rule.trigger,
    conditions: { kind: 'group', id: 'conditions', operator: rule.conditions.operator, children: rule.conditions.items.map((condition, index) => {
      const schema = persistenceRegistry.field('ticket', condition.field)!.value;
      return { ...condition, kind: 'condition', id: `condition-${index + 1}`, ...(condition.value !== undefined && schema.kind === 'reference' ? { value: resolve(condition.value, schema.resource) } : {}) };
    }) },
    actions: rule.actions.map((action, position) => ({ ...action, id: `action-${position + 1}`, position,
      configuration: Object.fromEntries(Object.entries(action.configuration).map(([key, value]) => {
        const schema = persistenceRegistry.action(action.type)!.configuration[key].value;
        return [key, schema.kind === 'reference' ? resolve(value, schema.resource) : value];
      })),
    })),
  };
  if (used.size !== pkg.references.length) reject('Remove unused organization references from this package.');
  const result = validateDefinition(definition, persistenceRegistry);
  if (!result.valid) reject(`Review the automation: ${result.issues.map(issue => issue.message).join(' ')}`);
  return result.value;
}

export function portablePreview(pkg: PortablePackage): { definition: AutomationDefinition; labels: Labels } {
  const checked = validatePortablePackage(pkg);
  return { definition: materialize(checked), labels: Object.fromEntries(checked.references.map((ref, index) => [placeholder(index), ref.sourceLabel])) };
}
export function resolvePortableDraft(pkg: PortablePackage, mapping: Readonly<Record<string, string>>) {
  return { definition: materialize(validatePortablePackage(pkg), mapping), enabled: false as const };
}

export function exportPortablePackage(input: AutomationDefinition, labels: Labels, exportedAt = new Date().toISOString()): PortablePackage {
  const checked = validateDefinition(input, persistenceRegistry);
  if (!checked.valid) return reject('This automation must be valid before it can be exported.');
  const definition = checked.value, references: PortableReference[] = [], identities = new Map<string, string>();
  const encode = (value: JsonValue, resource: string): JsonValue => {
    if (Array.isArray(value)) return value.map(item => encode(item, resource));
    const kind = kindFor(resource), identity = `${kind}:${String(value).toLowerCase()}`;
    let key = identities.get(identity);
    if (!key) {
      key = `ref-${references.length + 1}`; identities.set(identity, key);
      const label = labels[String(value)];
      references.push({ key, kind, sourceLabel: label && !UUID_PATTERN.test(label) ? label.slice(0, 180) : `Unavailable ${kind}` });
    }
    return { reference: key };
  };
  const pkg = { format: 'fixxflow-automation', version: 1, exportedAt, references, rules: [{
    name: definition.name, description: definition.description, trigger: definition.trigger,
    conditions: { operator: 'and', items: definition.conditions.children.map(condition => {
      if (condition.kind !== 'condition') return reject('Nested conditions are not portable in version 1.');
      const schema = persistenceRegistry.field('ticket', condition.field)!.value;
      return { field: condition.field, operator: condition.operator, ...(condition.value === undefined ? {} : { value: schema.kind === 'reference' ? encode(condition.value, schema.resource) : condition.value }) };
    }) },
    actions: definition.actions.map(action => ({ type: action.type, configuration: Object.fromEntries(Object.entries(action.configuration).map(([key, value]) => {
      const schema = persistenceRegistry.action(action.type)!.configuration[key].value;
      return [key, schema.kind === 'reference' ? encode(value, schema.resource) : value];
    })) })),
  }] };
  return validatePortablePackage(pkg);
}

export function portableFilename(name: string) {
  const stem = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
  return `${stem || 'automation'}.fixxflow.json`;
}
/** Only suggest a unique active exact name in a complete bounded result. Never confirm. */
export function suggestPortableReference(ref: PortableReference, rows: readonly Choice[], hasNext: boolean): Choice | null {
  if (hasNext) return null;
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase();
  const matches = rows.filter(row => row.active && normalize(row.label) === normalize(ref.sourceLabel));
  return matches.length === 1 ? matches[0] : null;
}
