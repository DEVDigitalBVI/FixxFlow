import 'server-only';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { automationRepository, AutomationPersistenceError } from './repository';
import { persistenceRegistry } from './persistence-contract';
import type { AdministrationErrorCode, AdministrationResult } from './persistence-model';
import { validateDefinition } from './validation';
import { isUuid } from './values';

const messages: Record<AdministrationErrorCode, string> = {
  automation_limit_reached: 'This organization has reached the active Automation safety limit. Disable another Automation before enabling this one.',
  definition_limit_exceeded: 'The automation definition exceeds the 256 KiB safety limit. Shorten notes or condition values.',
  forbidden: 'Administrator access and the required account verification are needed.',
  invalid_input: 'Check the automation identifier, version and request values.',
  invalid_definition: 'Check the automation configuration and available organization references.',
  conflict: 'This automation has changed. Reload it before saving your changes.',
  not_found: 'This automation is unavailable.',
  archived: 'This automation has been archived and cannot be changed.',
  unavailable: 'Automation management is temporarily unavailable. Try again.',
};
function failure(code: AdministrationErrorCode): AdministrationResult<never> { return { ok: false, error: { code, message: messages[code] } }; }
const errorCodes: Record<string, AdministrationErrorCode> = { 'FF001': 'automation_limit_reached', 'FF004': 'definition_limit_exceeded', '42501': 'forbidden', '22023': 'invalid_definition', '22P05': 'invalid_definition', '22021': 'invalid_definition', '40001': 'conflict', 'P0002': 'not_found', '55000': 'archived' };
type Repository = ReturnType<typeof automationRepository>;

async function administer<T>(work: (repository: Repository) => Promise<AdministrationResult<T>>): Promise<AdministrationResult<T>> {
  // requireViewer enforces authenticated identity and the existing MFA flow.
  // Keep its Next.js redirects outside the database error handler.
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator' || viewer.status !== 'active') return failure('forbidden');
  try { return await work(automationRepository(await createClient(), viewer.organizationId)); }
  catch (error) {
    if (error instanceof AutomationPersistenceError) return failure(errorCodes[error.code] ?? 'unavailable');
    // Unexpected programming failures remain observable; never return their text.
    throw error;
  }
}
const validTarget = (id: unknown, version: unknown): version is number => isUuid(id) && Number.isSafeInteger(version) && (version as number) > 0;
const validPage = (page: number) => Number.isSafeInteger(page) && page >= 1 && page <= 100000;
const success = <T>(value: T): AdministrationResult<T> => ({ ok: true, value });

export function listAutomations(page = 1, archived = false) {
  return administer(async repository => validPage(page) && typeof archived === 'boolean' ? success(await repository.list(page, archived)) : failure('invalid_input'));
}
export function getAutomation(ruleId: string) {
  return administer(async repository => isUuid(ruleId) ? success(await repository.get(ruleId)) : failure('invalid_input'));
}
export function getAutomationVersions(ruleId: string, page = 1) {
  return administer(async repository => isUuid(ruleId) && validPage(page) ? success(await repository.versions(ruleId, page)) : failure('invalid_input'));
}
export function createAutomation(input: unknown) {
  return administer(async repository => {
    const definition = validateDefinition(input, persistenceRegistry);
    if (!definition.valid) return { ok: false, error: { code: 'invalid_definition', message: messages.invalid_definition, issues: definition.issues } };
    return success(await repository.create(definition.value));
  });
}
export function updateAutomation(ruleId: string, expectedVersion: number, input: unknown) {
  return administer(async repository => {
    if (!validTarget(ruleId, expectedVersion)) return failure('invalid_input');
    const definition = validateDefinition(input, persistenceRegistry);
    if (!definition.valid) return { ok: false, error: { code: 'invalid_definition', message: messages.invalid_definition, issues: definition.issues } };
    return success(await repository.update(ruleId, expectedVersion, definition.value));
  });
}
export function duplicateAutomation(ruleId: string, expectedVersion: number, name: string) {
  return administer(async repository => validTarget(ruleId, expectedVersion) && typeof name === 'string' && name.trim().length > 0 && name.length <= 120
    ? success(await repository.duplicate(ruleId, expectedVersion, name)) : failure('invalid_input'));
}
export function setAutomationEnabled(ruleId: string, expectedVersion: number, enabled: boolean) {
  return administer(async repository => validTarget(ruleId, expectedVersion) && typeof enabled === 'boolean'
    ? success(await repository.setEnabled(ruleId, expectedVersion, enabled)) : failure('invalid_input'));
}
export function archiveAutomation(ruleId: string, expectedVersion: number) {
  return administer(async repository => validTarget(ruleId, expectedVersion) ? success(await repository.archive(ruleId, expectedVersion)) : failure('invalid_input'));
}
