import 'server-only';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { DryRunReadError, dryRunRepository } from './dry-run-repository';
import { evaluateDryRun } from './dry-run';
import { ticketDryRunEvent, validTicketSimulation } from './domains/tickets/dry-run-context';
import type { DryRunRequest, DryRunResponse } from './dry-run-model';
import { persistenceRegistry } from './persistence-contract';
import { validateDefinition } from './validation';
import { hasOnly, isBoundedJson, isRecord, isUuid } from './values';

const messages = { definition_limit_exceeded: 'The saved definition exceeds the 256 KiB safety limit. Shorten notes or condition values before testing.', forbidden: 'Administrator access and required verification are needed.', invalid_input: 'Check the ticket, rule version and test context.', invalid_definition: 'Check the structured automation definition.', not_found: 'The selected test source is unavailable.', unavailable: 'Automation testing is temporarily unavailable.' };
const failure = (code: keyof typeof messages): DryRunResponse => ({ ok: false, sideEffectsPerformed: false, notice: 'No changes were made.', error: { code, message: messages[code] } });
function validRequest(input: unknown): input is DryRunRequest {
  if (!isBoundedJson(input) || !isRecord(input) || !hasOnly(input, ['ticketId', 'definition', 'source']) || !isUuid(input.ticketId) || !isRecord(input.definition) || !isRecord(input.source)) return false;
  const definition = input.definition, source = input.source;
  const validDefinition = definition.kind === 'draft' ? hasOnly(definition, ['kind', 'value']) && Object.hasOwn(definition, 'value')
    : definition.kind === 'version' && hasOnly(definition, ['kind', 'ruleId', 'version']) && isUuid(definition.ruleId) && Number.isSafeInteger(definition.version) && (definition.version as number) > 0;
  return validDefinition && (source.kind === 'current_ticket' ? hasOnly(source, ['kind'])
    : source.kind === 'retained_event' ? hasOnly(source, ['kind', 'eventId']) && isUuid(source.eventId)
      : source.kind === 'simulated_transition' && hasOnly(source, ['kind', 'after']) && validTicketSimulation(source.after));
}
/** Session-based service for future Server Actions. It cannot dispatch execution. */
export async function testAutomation(input: unknown): Promise<DryRunResponse> {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator' || viewer.status !== 'active') return failure('forbidden');
  if (!validRequest(input)) return failure('invalid_input');
  if (input.definition.kind === 'draft') {
    const validated = validateDefinition(input.definition.value, persistenceRegistry);
    if (!validated.valid) return { ok: false, sideEffectsPerformed: false, notice: 'No changes were made.', error: { code: 'invalid_definition', message: messages.invalid_definition, issues: validated.issues } };
    input = { ...input, definition: { kind: 'draft', value: validated.value } };
  }
  try {
    const request = input as DryRunRequest;
    const context = await dryRunRepository(await createClient(), viewer.organizationId).read(request);
    return { ok: true, value: evaluateDryRun(context, ticketDryRunEvent(context, request.source), request.source, persistenceRegistry) };
  } catch (error) {
    if (error instanceof DryRunReadError) return failure(error.code === '42501' ? 'forbidden' : error.code === 'P0002' ? 'not_found' : error.code === 'FF004' ? 'definition_limit_exceeded' : error.code === '22023' ? 'invalid_definition' : 'unavailable');
    throw error;
  }
}
