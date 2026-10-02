import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { AutomationAction, AutomationRule } from './model';
import type { DomainEvent } from '@/lib/events/model';
import type { DomainDeliveryFailure } from '@/lib/events/delivery';
import type { AutomationExecutionRow, AutomationExecutionStepRow } from '@/types/automation-execution-database';
import { persistenceRegistry } from './persistence-contract';
import { planAutomation } from './planner';
import { validateEvent, validateRule } from './validation';
import { AutomationWorkerError, classifyWorkerFailure } from './worker-failures';

export type WorkerDelivery = { deliveryId: string; leaseToken: string; leaseExpiresAt: string; attempts: number; event: unknown };
export type RuleCursor = { createdAt: string; ruleId: string };
export type DiscoveredRule = { rule: unknown; cursor: RuleCursor };
export interface AutomationWorkerStore {
  claim(): Promise<WorkerDelivery[]>;
  discover(delivery: WorkerDelivery, cursor: RuleCursor | null): Promise<DiscoveredRule[]>;
  begin(delivery: WorkerDelivery, rule: AutomationRule): Promise<AutomationExecutionRow>;
  execute(delivery: WorkerDelivery, execution: AutomationExecutionRow, action: AutomationAction): Promise<AutomationExecutionStepRow>;
  execution(delivery: WorkerDelivery, id: string): Promise<AutomationExecutionRow>;
  finish(delivery: WorkerDelivery, outcome: 'acknowledged' | 'retry' | 'failed' | 'deferred', code?: DomainDeliveryFailure): Promise<boolean>;
}
export type AutomationLog = {
  result: string; code?: string; deliveryId?: string; executionId?: string;
  stepId?: string; actionId?: string; actionPosition?: number;
  organizationId?: string; ruleId?: string; ruleVersion?: number; eventId?: string; eventType?: string; correlationId?: string;
};
export type WorkerOptions = { enabled: boolean; now?: () => number; budgetMs?: number; log?: (entry: AutomationLog) => void };

/** Orchestration only: no table writes, new evaluator, provider calls or authority. */
export async function runAutomationWorker(store: AutomationWorkerStore, options: WorkerOptions) {
  const result = { disabled: !options.enabled, claimed: 0, acknowledged: 0, retried: 0, failed: 0, deferred: 0, capacityDeferred: 0 };
  if (!options.enabled) return result;
  const now = options.now ?? Date.now, deadline = now() + (options.budgetMs ?? 45_000);
  const log = options.log ?? (() => {});
  const deliveries = await store.claim(); result.claimed = deliveries.length;
  for (const delivery of deliveries) {
    let context: AutomationLog = { deliveryId: delivery.deliveryId, result: 'claimed' };
    const checkTime = () => {
      if (now() >= Date.parse(delivery.leaseExpiresAt)) throw new AutomationWorkerError('lease_lost');
      if (now() >= deadline) throw new AutomationWorkerError('budget_exhausted');
    };
    try {
      const checked = validateEvent(delivery.event);
      if (!checked.valid) throw new AutomationWorkerError('invalid_event');
      const event: DomainEvent = checked.value;
      context = { ...context, organizationId: event.organizationId, eventId: event.id, eventType: event.type, correlationId: event.correlationId };
      log(context);
      let cursor: RuleCursor | null = null;
      while (true) {
        checkTime(); const rules = await store.discover(delivery, cursor);
        for (const candidate of rules) {
          checkTime();
          const checkedRule = validateRule(candidate.rule, persistenceRegistry);
          if (!checkedRule.valid) throw new AutomationWorkerError('invalid_configuration');
          const rule = checkedRule.value;
          context = { ...context, ruleId: rule.id, ruleVersion: rule.version, executionId: undefined };
          const plan = planAutomation(rule, event, persistenceRegistry, event.organizationId);
          if (!['ready', 'conditions_failed', 'condition_error'].includes(plan.status)) throw new AutomationWorkerError(plan.status === 'tenant_mismatch' ? 'authorization_failed' : ['invalid_event', 'incompatible_trigger'].includes(plan.status) ? 'invalid_event' : 'invalid_configuration');
          let execution: AutomationExecutionRow;
          try { execution = await store.begin(delivery, rule); }
          catch (error) {
            // A concurrent disable/edit can remove eligibility after discovery.
            if (error instanceof AutomationWorkerError && error.code === '55000') { log({ ...context, result: 'ineligible' }); continue; }
            throw error;
          }
          context = { ...context, executionId: execution.id };
          if (execution.organization_id !== event.organizationId || execution.event_id !== event.id || execution.rule_id !== rule.id || execution.rule_version !== rule.version || execution.entity_id !== event.entityId) throw new AutomationWorkerError('invalid_storage');
          if (!isDeepStrictEqual(plan.conditions, execution.conditions)) throw new AutomationWorkerError('planner_mismatch');
          if (execution.status !== 'running') { log({ ...context, result: execution.status, code: execution.error_code ?? undefined }); continue; }
          if (plan.status !== 'ready') throw new AutomationWorkerError('planner_mismatch');
          for (const { action } of plan.actions) {
            checkTime(); const step = await store.execute(delivery, execution, action);
            if (step.organization_id !== event.organizationId || step.execution_id !== execution.id || step.action_id !== action.id || step.position !== action.position) throw new AutomationWorkerError('invalid_storage');
            log({ ...context, stepId: step.id, actionId: step.action_id, actionPosition: step.position, result: `step_${step.status}`, code: step.error_code ?? undefined });
            if (step.status !== 'succeeded') break;
          }
          checkTime(); execution = await store.execution(delivery, execution.id);
          if (execution.status === 'running') throw new AutomationWorkerError('invalid_storage');
          log({ ...context, result: execution.status, code: execution.error_code ?? undefined });
        }
        if (rules.length < 50) break;
        const next = rules[rules.length - 1].cursor;
        if (cursor?.createdAt === next.createdAt && cursor?.ruleId === next.ruleId) throw new AutomationWorkerError('invalid_storage');
        cursor = next;
      }
      checkTime();
      if (await store.finish(delivery, 'acknowledged')) { result.acknowledged++; log({ ...context, result: 'acknowledged' }); }
      else { result.deferred++; log({ ...context, result: 'lease_lost' }); }
    } catch (error) {
      const failure = classifyWorkerFailure(error);
      log({ ...context, result: failure.outcome, code: failure.code });
      try {
        if (await store.finish(delivery, failure.outcome, failure.code)) {
          if (failure.outcome === 'deferred') { result.deferred++; result.capacityDeferred++; }
          else if (failure.outcome === 'retry' && delivery.attempts < 8) result.retried++;
          else { result.failed++; if (failure.outcome === 'retry') log({ ...context, result: 'dead', code: 'retry_exhausted' }); }
        } else { result.deferred++; log({ ...context, result: 'lease_lost' }); }
      } catch { result.deferred++; log({ ...context, result: 'acknowledgement_unavailable', code: 'transient_failure' }); }
    }
  }
  return result;
}
