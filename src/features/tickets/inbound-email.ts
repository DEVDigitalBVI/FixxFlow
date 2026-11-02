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
  if (address.length > 320 || /[\s<>]/.test(address)) return null;
  const parts = address.split('@');
  if (parts.length !== 2 || !parts[0]) return null;
  const labels = parts[1].split('.');
  return labels.length >= 2 && labels.every(Boolean) ? address : null;
}

/** Extracts text only; the result must always be rendered as text, never HTML. */
function htmlText(html: string, inlineCids?: Set<string>): string {
  const output: string[] = [];
  let hidden: string | null = null;
  let cursor = 0;
  while (cursor < html.length) {
    if (html[cursor] !== '<') {
      if (!hidden) output.push(html[cursor]);
      cursor++;
      continue;
    }
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    let end = cursor + 1;
    let quote: string | null = null;
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === html.length) break;
    const tag = html
      .slice(cursor + 1, end)
      .trim()
      .toLowerCase();
    const closing = tag.startsWith('/');
    const name = (closing ? tag.slice(1).trimStart() : tag).match(/^[a-z0-9]+/)?.[0];
    if (hidden) {
      if (closing && name === hidden) hidden = null;
    } else if (!closing && ['script', 'style', 'head'].includes(name ?? '')) hidden = name ?? null;
    else if (
      !closing &&
      /(?:gmail_signature|gmail_quote|yahoo_quoted|moz-signature|divrplyfwdmsg|id=["']signature["'])/i.test(
        tag,
      ) &&
      output.join('').trim()
    )
      break;
    else if (!closing && name === 'img') {
      const cid = tag.match(/\bsrc\s*=\s*["']cid:([^"']+)["']/i)?.[1];
      if (cid) inlineCids?.add(cid.replace(/^<|>$/g, '').toLowerCase());
    } else if (!closing && name === 'blockquote') {
      if (output.some((value) => value.trim())) break;
      hidden = 'blockquote';
    } else if (name === 'br' || (closing && ['p', 'div', 'li'].includes(name ?? '')))
      output.push('\n');
    cursor = end + 1;
  }
  const entities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
  };
  // One pass prevents an encoded ampersand from starting a second decode.
  return output
    .join('')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|#x[0-9a-f]{1,6}|#\d{1,7});/gi, (_, name: string) => {
      if (entities[name.toLowerCase()]) return entities[name.toLowerCase()];
      const value = Number.parseInt(
        name.slice(name[1]?.toLowerCase() === 'x' ? 2 : 1),
        name[1]?.toLowerCase() === 'x' ? 16 : 10,
      );
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : '';
    });
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
  const source = text?.trim() || htmlText(html ?? '');
  const kept: string[] = [];
  const lines = source.slice(0, 250000).replace(/\r\n?/g, '\n').split('\n');
  let hasContent = false;
  for (const [index, line] of lines.entries()) {
    if (
      hasContent &&
      /^(?:Kind regards|Best regards|Regards|Sincerely|Thanks|Thank you)[,!]?$/i.test(line.trim())
    ) {
      const tail = lines.slice(index + 1).filter((value) => value.trim());
      if (
        tail.length <= 12 &&
        (tail.some((value) => /@|https?:|(?:tel|phone|mobile):|\+?\d[\d ()-]{6,}/i.test(value)) ||
          (tail.length <= 2 && tail.every((value) => /^[\p{L} .'-]{1,60}$/u.test(value))))
      )
        break;
    }
    if (
      /^On .+wrote:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      (hasContent &&
        (/^-- $/.test(line) ||
          /^(?:Sent from my (?:iPhone|iPad|Android)|Get Outlook for (?:iOS|Android))/i.test(
            line.trim(),
          )))
    )
      break;
    if (/^From: .+/i.test(line.trim()) && kept.length) break;
    if (line.trimStart().startsWith('>')) continue;
    kept.push(line);
    if (line.trim()) hasContent = true;
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 19000);
}

/** Canonical RFC Message-IDs only: no arbitrary header text reaches SQL or outgoing headers. */
export function messageIds(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const raw = value.slice(0, 30000);
  const matches: string[] = raw.match(/<[^<>\s@]{1,250}@[^<>\s@]{1,250}>/g) ?? [];
  if (!matches.length && /^[^<>\s@]{1,250}@[^<>\s@]{1,250}$/.test(raw)) matches.push(`<${raw}>`);
  return [...new Set(matches)].slice(-50);
}
export function emailThreadHeaders(email: { message_id?: unknown; headers?: unknown }) {
  const headers =
    email.headers && typeof email.headers === 'object'
      ? Object.fromEntries(
          Object.entries(email.headers).map(([key, value]) => [key.toLowerCase(), value]),
        )
      : {};
  const message_id = messageIds(email.message_id ?? headers['message-id'])[0] ?? null;
  const reply_message_ids = [
    ...new Set([...messageIds(headers.references), ...messageIds(headers['in-reply-to'])]),
  ].slice(-50);
  return { message_id, reply_message_ids };
}
export function emailAttachmentIds(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return [
    ...new Set(
      attachments.flatMap((item) =>
        item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200
          ? [item.id]
          : [],
      ),
    ),
  ].slice(0, 20);
}

/** Only inline images referenced before known signature/quote containers are eligible. */
export function emailInlineAttachmentIds(attachments: unknown, html: unknown): string[] {
  if (!Array.isArray(attachments) || typeof html !== 'string') return [];
  const cids = new Set<string>();
  htmlText(html.slice(0, 2000000), cids);
  return emailAttachmentIds(
    attachments.filter(
      (item) =>
        item &&
        typeof item.content_id === 'string' &&
        cids.has(item.content_id.replace(/^<|>$/g, '').toLowerCase()),
    ),
  );
}
