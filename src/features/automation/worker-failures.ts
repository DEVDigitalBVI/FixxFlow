import type { DomainDeliveryFailure } from '@/lib/events/delivery';

export class AutomationWorkerError extends Error {
  constructor(readonly code: string, readonly status?: number) { super('Automation processing failed'); }
}
export type WorkerFailure = { outcome: 'retry' | 'failed'; code: DomainDeliveryFailure };
/** Unknown/programming errors fail closed. Never classify from raw message text. */
export function classifyWorkerFailure(error: unknown): WorkerFailure {
  const code = error instanceof AutomationWorkerError ? error.code : '';
  if (['invalid_event', 'invalid_configuration', 'planner_mismatch'].includes(code)) return { outcome: 'failed', code: code as DomainDeliveryFailure };
  if (code === '42501' || code === 'authorization_failed') return { outcome: 'failed', code: 'authorization_failed' };
  if (code === '54000') return { outcome: 'failed', code: 'chain_limit' };
  if (['22023', '55000', 'P0002', 'invalid_storage'].includes(code)) return { outcome: 'failed', code: 'permanent_failure' };
  if (['transport', 'lease_lost', 'budget_exhausted', '40001', '40P01', '55P03', '57014', '53300', '57P01', '57P02', '57P03', '08000', '08003', '08006', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code)) return { outcome: 'retry', code: 'transient_failure' };
  if (error instanceof AutomationWorkerError && (error.status === 0 || [502, 503, 504].includes(error.status ?? -1))) return { outcome: 'retry', code: 'transient_failure' };
  return { outcome: 'failed', code: 'permanent_failure' };
}
