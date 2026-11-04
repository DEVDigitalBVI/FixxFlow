import 'server-only';

import { createHash, createHmac } from 'node:crypto';

export const INVITATION_HOURS = 72;
// Domain-separated derivation; stable retries produce the same email and token.
// Issued links are verified against their stored hash. After a server-key rotation,
// administrators can issue a new link if an interrupted email send needs retrying.
export function invitationToken(id: string, secret: string) {
  if (secret.length < 20) throw new Error('Invitation signing is not configured');
  return createHmac('sha256', secret)
    .update(`fixxflow/workspace-invitation/v1/${id}`)
    .digest('hex');
}
export function invitationTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
