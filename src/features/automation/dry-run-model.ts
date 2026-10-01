import type { DomainEvent, EntitySnapshot, JsonValue } from '@/lib/events/model';
import type { AutomationDefinition, ConditionOperator, ValidationIssue } from './model';
import type { AutomationPlan } from './planner';

export type DryRunSource = { kind: 'current_ticket' } | { kind: 'retained_event'; eventId: string }
  | { kind: 'simulated_transition'; after: { status?: string; priority?: string } };
export type DryRunRequest = {
  ticketId: string;
  definition: { kind: 'draft'; value: unknown } | { kind: 'version'; ruleId: string; version: number };
  source: DryRunSource;
};
/** Read model from the one authorized, read-only database statement. */
export type DryRunContext = {
  organizationId: string; ticketId: string; ticketNumber: number; revision: number;
  evaluatedAt?: string;
  snapshot: EntitySnapshot; event: DomainEvent | null; definition: AutomationDefinition;
  ruleId: string | null; ruleVersion: number | null; storedEnabled: boolean | null; storedArchived: boolean;
  conditionsReferencesValid: boolean; actionReferences: { actionId: string; valid: boolean }[];
};
export type DryRunResult = {
  temporal?: import('./domains/tickets/temporal').TemporalEvaluation;
  sideEffectsPerformed: false; notice: 'No changes were made.';
  structuralValidation: { valid: boolean; issues: readonly ValidationIssue[] };
  context: { source: DryRunSource['kind']; ticketId: string; ticketNumber: number; currentRevision: number; evaluatedRevision: number; eventId: string | null; simulatedFields: readonly string[]; differsFromCurrent: boolean; ruleId: string | null; ruleVersion: number | null };
  trigger: { compatible: boolean | null; explanation: string };
  conditions: readonly { id: string; field: string; label: string; operator: ConditionOperator; expected?: JsonValue; actual?: JsonValue; actualRedacted: boolean; status: 'passed' | 'failed' | 'error' | 'not_evaluated' }[];
  conditionsPassed: boolean;
  currentReferencesValid: boolean;
  actions: readonly { id: string; type: string; label: string; position: number; configuration: Readonly<Record<string, JsonValue>>; validation: 'valid' | 'invalid' | 'blocked'; explanation: string }[];
  plannerStatus: AutomationPlan['status']; wouldProceed: boolean; warnings: readonly string[];
};
export type DryRunResponse = { ok: true; value: DryRunResult } | { ok: false; sideEffectsPerformed: false; notice: 'No changes were made.'; error: { code: 'forbidden' | 'invalid_input' | 'invalid_definition' | 'not_found' | 'unavailable'; message: string; issues?: readonly ValidationIssue[] } };
