import type { AutomationDefinition, AutomationRule, ValidationIssue } from './model';

// Persistence metadata surrounds the established, exact Stage 1 rule contract.
export type PersistedAutomationRule = {
  readonly rule: AutomationRule;
  readonly updatedBy: string;
  readonly enabledAt: string | null;
  readonly archivedAt: string | null;
};
export type AutomationRuleVersion = {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly version: number;
  readonly definition: AutomationDefinition;
  readonly enabled: boolean;
  readonly enabledAt: string | null;
  readonly archivedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
};
export type AdministrationErrorCode = 'forbidden' | 'invalid_input' | 'invalid_definition' | 'conflict' | 'not_found' | 'archived' | 'unavailable';
export type AdministrationResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly error: { readonly code: AdministrationErrorCode; readonly message: string; readonly issues?: readonly ValidationIssue[] };
};
