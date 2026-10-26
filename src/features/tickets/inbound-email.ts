import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Resend signs webhooks through Svix; deliveries older than this are rejected. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Svix-signed webhook against the raw request body.
 * `secret` is the endpoint signing secret (whsec_...).
 */
export function verifyWebhookSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret.startsWith('whsec_') || !id || !timestamp || !signature) return false;
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  // The header may carry several space-separated "v1,<base64>" signatures (key rotation).
  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const candidate = Buffer.from(value, 'base64');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/** "Jordan Morgan <jordan@example.com>" or a bare address → lowercase address, or null. */
export function emailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = (value.match(/<([^<>\s]+)>/)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) && address.length <= 320 ? address : null;
}

/** First recipient on the inbound domain, as a workspace slug. */
export function workspaceSlug(recipients: unknown[], domain: string): string | null {
  const suffix = `@${domain.toLowerCase()}`;
  for (const recipient of recipients) {
    const address = emailAddress(recipient);
    if (!address?.endsWith(suffix)) continue;
    const slug = address.slice(0, -suffix.length);
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 63) return slug;
  }
  return null;
}

/**
 * Plain-text message body without quoted history: stops at the usual reply markers
 * and drops ">" quote lines. Falls back to HTML with tags removed.
 */
export function messageBody(text: string | null | undefined, html: string | null | undefined) {
  const source =
    text?.trim() ||
    (html ?? '')
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const kept: string[] = [];
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (
      /^On .+wrote:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())
    )
      break;
    if (/^From: .+/i.test(line.trim()) && kept.length) break;
    if (line.trimStart().startsWith('>')) continue;
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 19000);
}
