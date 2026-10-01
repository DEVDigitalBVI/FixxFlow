import type { Json } from './database.generated';
import type { DomainDeliveryFailure } from '@/lib/events/delivery';

// Private infrastructure tables deliberately have no application table API.
export type DomainEventFunctions = {
  claim_domain_events: {
    Args: { batch_size?: number; lease_seconds?: number; consumer_name?: string };
    Returns: { delivery_id: string; lease_token: string; lease_expires_at: string; attempts: number; event: Json }[];
  };
  finish_domain_event_delivery: {
    Args: { delivery_id: string; token: string; outcome: 'acknowledged' | 'retry' | 'failed'; failure_code?: DomainDeliveryFailure | null };
    Returns: boolean;
  };
};
