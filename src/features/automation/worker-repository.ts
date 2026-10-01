import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { AutomationWorkerStore } from './worker';
import { AutomationWorkerError } from './worker-failures';

async function data<T>(request: PromiseLike<{ data: T | null; error: { code?: string } | null; status?: number }>): Promise<T> {
  let response;
  try { response = await request; }
  catch (error) { throw new AutomationWorkerError(error instanceof TypeError ? 'transport' : 'unexpected_transport'); }
  if (response.error) throw new AutomationWorkerError(response.error.code ?? '', response.status);
  if (response.data == null) throw new AutomationWorkerError('invalid_storage');
  return response.data;
}
/** Privileged client stays on the server; all access uses constrained RPCs. */
export function automationWorkerRepository(client: SupabaseClient<Database>): AutomationWorkerStore {
  return {
    async claim() {
      return (await data(client.rpc('claim_automation_events', { batch_size: 5, lease_seconds: 120 }))).map(row => ({ deliveryId: row.delivery_id, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at, attempts: row.attempts, event: row.event }));
    },
    async discover(delivery, cursor) {
      return (await data(client.rpc('discover_automation_rules', { delivery_id: delivery.deliveryId, token: delivery.leaseToken, after_created_at: cursor?.createdAt ?? null, after_rule_id: cursor?.ruleId ?? null, batch_size: 50 })))
        .map(row => ({ rule: row.rule, cursor: { createdAt: row.sort_created_at, ruleId: row.rule_id } }));
    },
    begin(delivery, rule) { return data(client.rpc('begin_automation_execution', { delivery_id: delivery.deliveryId, token: delivery.leaseToken, rule_id: rule.id, rule_version: rule.version }).single()); },
    execute(delivery, execution, action) { return data(client.rpc('execute_automation_ticket_step', { execution_id: execution.id, token: delivery.leaseToken, command: JSON.parse(JSON.stringify({ organizationId: execution.organization_id, entityId: execution.entity_id, action })) as Json }).single()); },
    execution(delivery, id) { return data(client.rpc('get_automation_execution', { execution_id: id, token: delivery.leaseToken }).single()); },
    finish(delivery, outcome, code) { return data(client.rpc('finish_domain_event_delivery', { delivery_id: delivery.deliveryId, token: delivery.leaseToken, outcome, failure_code: code ?? null })); },
  };
}
