import 'server-only';

import { timingSafeEqual } from 'node:crypto';

export function isCronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
