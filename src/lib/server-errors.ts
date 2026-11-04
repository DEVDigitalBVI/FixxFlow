import 'server-only';

import { randomUUID } from 'node:crypto';

export type FailureOperation =
  | 'invitation.finalize'
  | 'auth.password.update'
  | 'auth.signout'
  | 'auth.session'
  | 'workspace.search'
  | 'knowledge.choices'
  | 'knowledge.suggestions'
  | 'inbound.email'
  | 'equipment.reminders'
  | 'inventory.mutation'
  | 'viewer.membership'
  | 'viewer.platform'
  | 'viewer.details'
  | 'profile.load'
  | 'profile.save'
  | 'lookup.load'
  | 'ticket.references'
  | 'ticket.load'
  | 'ticket.save'
  | 'ticket.reopen'
  | 'incident.save'
  | 'ticket.create'
  | 'chat.assign'
  | 'chat.idle'
  | 'notification.dispatch'
  | 'notification.send'
  | 'email-announcement.prepare'
  | 'email-announcement.queue'
  | 'email-announcement.send'
  | 'email-announcement.dispatch'
  | 'email-announcement.status'
  | 'report.workload.load'
  | 'report.export'
  | 'report.saved.load'
  | 'report.save'
  | 'report.delete'
  | 'report.schedule.save'
  | 'report.schedule.manage'
  | 'report.schedule.delivery'
  | 'report.schedule.dispatch'
  | 'report.custom.export'
  | 'health.readiness'
  | 'ticket.rating'
  | 'report.satisfaction'
  | 'platform.organization.export'
  | 'platform.analytics.cleanup'
  | 'analytics.cleanup';

const authFailureCodes = new Set([
  'weak_password',
  'same_password',
  'reauthentication_needed',
  'reauthentication_not_valid',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'user_not_found',
  'over_request_rate_limit',
]);

/** Allowlisted metadata only. Never serialize errors, request data, tokens or PII. */
export function reportServerError(
  operation: FailureOperation,
  error?: unknown,
  correlationId = randomUUID(),
) {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code =
    typeof raw === 'string' &&
    (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|ECONNRESET|ETIMEDOUT|ECONNREFUSED)$/.test(raw) ||
      authFailureCodes.has(raw))
      ? raw
      : 'UNEXPECTED';
  console.error(JSON.stringify({ event: 'application.failure', operation, code, correlationId }));
  return correlationId;
}
