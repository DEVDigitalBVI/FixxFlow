import 'server-only';
import { randomUUID } from 'node:crypto';

export type FailureOperation = 'viewer.membership' | 'viewer.platform' | 'viewer.details' | 'profile.load' | 'profile.save' | 'lookup.load' | 'ticket.references' | 'ticket.load' | 'ticket.save' | 'ticket.create' | 'chat.assign' | 'notification.dispatch' | 'notification.send' | 'report.export';

/** Allowlisted metadata only. Never serialize errors, request data, tokens or PII. */
export function reportServerError(operation: FailureOperation, error?: unknown, correlationId = randomUUID()) {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code = typeof raw === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|ECONNRESET|ETIMEDOUT|ECONNREFUSED)$/.test(raw) ? raw : 'UNEXPECTED';
  console.error(JSON.stringify({ event: 'application.failure', operation, code, correlationId }));
  return correlationId;
}
