import { randomBytes } from 'node:crypto';

import { after } from 'next/server';

import { endCurrentSession } from '@/features/auth/logout';
import { logoutDocument } from '@/features/auth/logout-document';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return new Response('Forbidden', { status: 403 });
  const result = await endCurrentSession(after);
  const nonce = randomBytes(18).toString('base64');
  return new Response(logoutDocument(result.userId, nonce, result.revoked), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'Clear-Site-Data': '"cache", "storage"',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    },
  });
}

export async function GET() {
  return new Response(
    '<!doctype html><html lang="en"><head><title>Sign out · FixxFlow</title></head><body><main><h1>Sign out</h1><form method="post" action="/auth/sign-out"><button type="submit">Sign out of FixxFlow</button></form></main></body></html>',
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    },
  );
}
