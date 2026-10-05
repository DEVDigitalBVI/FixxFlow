import type { DomainEvent } from './model';

/** Transport contract only. No worker or action execution is implemented here. */
export type DomainEventDelivery = {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly attempts: number;
  readonly event: DomainEvent;
};
export type DomainDeliveryFailure = import('@/features/automation/limits').AutomationCapacityCode | 'transient_failure' | 'invalid_event' | 'unsupported_event' | 'permanent_failure' | 'chain_limit' | 'invalid_configuration' | 'planner_mismatch' | 'authorization_failed';
export type DomainDeliveryOutcome = { readonly outcome: 'acknowledged' } | {
  readonly outcome: 'retry' | 'failed';
  readonly failureCode: DomainDeliveryFailure;
};
