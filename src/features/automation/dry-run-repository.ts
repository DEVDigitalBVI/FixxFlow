import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { DryRunContext, DryRunRequest } from './dry-run-model';
import { persistenceRegistry } from './persistence-contract';
import { validateDefinition, validateEvent } from './validation';
import { isRecord } from './values';

export class DryRunReadError extends Error {
  constructor(readonly code: string) { super('Automation test source unavailable'); }
}
/** Only this single read RPC is reachable: no mutation repository/client escapes. */
export function dryRunRepository(client: SupabaseClient<Database>, organizationId: string) {
  return {
    async read(request: DryRunRequest): Promise<DryRunContext> {
      const { data, error } = await client.rpc('read_automation_dry_run', {
        target_organization_id: organizationId, ticket_id: request.ticketId,
        event_id: request.source.kind === 'retained_event' ? request.source.eventId : null,
        rule_id: request.definition.kind === 'version' ? request.definition.ruleId : null,
        rule_version: request.definition.kind === 'version' ? request.definition.version : null,
        draft: request.definition.kind === 'draft' ? request.definition.value as Json : null,
      });
      if (error) throw new DryRunReadError(error.code);
      if (!isRecord(data) || data.organizationId !== organizationId || data.ticketId !== request.ticketId || !isRecord(data.snapshot)
        || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || !Number.isSafeInteger(data.ticketNumber)
        || typeof data.conditionsReferencesValid !== 'boolean' || typeof data.storedArchived !== 'boolean'
        || !(data.storedEnabled === null || typeof data.storedEnabled === 'boolean') || !Array.isArray(data.actionReferences)) throw new DryRunReadError('invalid_storage');
      const references = data.actionReferences;
      const definition = validateDefinition(data.definition, persistenceRegistry);
      if (!definition.valid || references.length !== definition.value.actions.length
        || definition.value.actions.some(action => references.filter((check: unknown) => isRecord(check) && check.actionId === action.id && typeof check.valid === 'boolean').length !== 1)) throw new DryRunReadError('invalid_storage');
      if (request.definition.kind === 'version' ? data.ruleId !== request.definition.ruleId || data.ruleVersion !== request.definition.version : data.ruleId !== null || data.ruleVersion !== null) throw new DryRunReadError('invalid_storage');
      if (request.source.kind === 'retained_event') {
        const event = validateEvent(data.event);
        if (!event.valid || event.value.id !== request.source.eventId || event.value.entityId !== request.ticketId || event.value.organizationId !== organizationId || event.value.entityType !== 'ticket') throw new DryRunReadError('invalid_storage');
      } else if (data.event !== null) throw new DryRunReadError('invalid_storage');
      return { ...data, definition: definition.value } as DryRunContext;
    },
  };
}
