import 'server-only';

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { validAttachment } from '@/lib/uploads';
import type { Database } from '@/types/database';

export type InboundAttachmentJob = {
  id: string;
  lease_token: string;
  organization_id: string;
  ticket_id: string;
  sender_id: string;
  provider_email_id: string;
  attachment_ids: string[];
  processed_ids: string[];
  inline_ids?: string[];
  total_bytes: number;
};
export type ReceivedAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  content_disposition?: string;
  download_url: string;
};
const EXTENSIONS: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt', 'log'],
};
export function inboundFileName(name: string) {
  const base = (name.split(/[\\/]/).pop() ?? 'attachment')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  const extension = base.split('.').pop() ?? '';
  return base.length <= 120
    ? base
    : `${base.slice(0, Math.max(1, 118 - extension.length))}.${extension}`;
}
export function inboundContentType(file: Pick<ReceivedAttachment, 'content_type' | 'filename'>) {
  const declared = file.content_type.split(';')[0].trim().toLowerCase();
  if (declared === 'application/octet-stream' && /\.(txt|log)$/i.test(file.filename))
    return 'text/plain';
  return declared;
}
export function validInboundMetadata(file: ReceivedAttachment, allowInline = false) {
  if (
    !file ||
    typeof file.filename !== 'string' ||
    typeof file.content_type !== 'string' ||
    !Number.isSafeInteger(file.size)
  )
    return false;
  const type = inboundContentType(file);
  const extension = file.filename?.split('.').pop()?.toLowerCase();
  return (
    typeof file.filename === 'string' &&
    file.filename.length > 0 &&
    (file.content_disposition?.toLowerCase() !== 'inline' ||
      (allowInline &&
        type.startsWith('image/') &&
        file.size >= 4096 &&
        !/(?:logo|signature|banner|tracking|pixel|facebook|linkedin|instagram)/i.test(
          file.filename,
        ))) &&
    validAttachment({ type, size: file.size }) &&
    Boolean(EXTENSIONS[type]?.includes(extension ?? ''))
  );
}
export function validInboundBytes(bytes: Uint8Array, type: string): boolean {
  const head = Buffer.from(bytes.subarray(0, 32));
  if (type === 'image/png')
    return (
      bytes.length >= 24 &&
      head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      head.toString('ascii', 12, 16) === 'IHDR' &&
      head.readUInt32BE(16) > 0 &&
      head.readUInt32BE(20) > 0
    );
  if (type === 'image/jpeg')
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217
    );
  if (type === 'image/webp')
    return (
      bytes.length >= 16 &&
      head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(head.toString('ascii', 12, 16)) &&
      head.readUInt32LE(4) + 8 <= bytes.length
    );
  if (type === 'application/pdf')
    return (
      head.toString('ascii', 0, 5) === '%PDF-' &&
      Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).includes(Buffer.from('%%EOF'))
    );
  if (type === 'text/plain') {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
export function inboundStoragePath(
  job: Pick<InboundAttachmentJob, 'id' | 'organization_id' | 'ticket_id' | 'sender_id'>,
  attachmentId: string,
) {
  const hex = createHash('md5').update(`${job.id}:${attachmentId}`).digest('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `${job.organization_id}/${job.ticket_id}/${job.sender_id}/inbound-${uuid}`;
}
export class EmailSizeLimitError extends Error {}

export async function boundedResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error('Email provider request failed');
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new EmailSizeLimitError('Email response exceeds allowed size');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty email response');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new EmailSizeLimitError('Email response exceeds allowed size');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function processInboundAttachments(
  apiKey: string,
  {
    database = createAdminClient(),
    request = fetch,
    now = Date.now,
  }: { database?: SupabaseClient<Database>; request?: typeof fetch; now?: () => number } = {},
) {
  const started = now();
  const claimed = await database.rpc('claim_inbound_attachments', { batch_size: 1 });
  if (claimed.error) throw claimed.error;
  const jobs = claimed.data as unknown as InboundAttachmentJob[];
  if (!Array.isArray(jobs)) throw new Error('Invalid attachment queue response');
  let imported = 0,
    skipped = 0,
    failed = 0;
  for (const job of jobs) {
    let success = false;
    let total = job.total_bytes;
    const record = async (id: string, saved: boolean, file?: ReceivedAttachment, bytes = 0) => {
      const result = await database.rpc('record_inbound_attachment', {
        job_id: job.id,
        token: job.lease_token,
        provider_attachment_id: id,
        imported: saved,
        ...(file
          ? {
              file_name: inboundFileName(file.filename),
              content_type: inboundContentType(file),
              size_bytes: bytes,
            }
          : {}),
      });
      if (result.error || !result.data)
        throw result.error ?? new Error('Attachment lease is no longer available');
    };
    try {
      for (const id of job.attachment_ids) {
        if (job.processed_ids.includes(id)) continue;
        if (now() - started > 40000) throw new Error('Attachment worker time budget reached');
        const metadata = await request(
          `https://api.resend.com/emails/receiving/${encodeURIComponent(job.provider_email_id)}/attachments/${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
          },
        );
        const file = JSON.parse(
          new TextDecoder().decode(await boundedResponse(metadata, 128000)),
        ) as ReceivedAttachment;
        if (
          file.id !== id ||
          !validInboundMetadata(file, job.inline_ids?.includes(id)) ||
          total + file.size > 20 * 1024 * 1024
        ) {
          await record(id, false);
          skipped++;
          continue;
        }
        const url = new URL(file.download_url);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'inbound-cdn.resend.com' ||
          url.username ||
          url.password ||
          (url.port && url.port !== '443')
        )
          throw new Error('Untrusted email attachment location');
        const response = await request(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        let bytes: Uint8Array;
        try {
          bytes = await boundedResponse(response, 10 * 1024 * 1024);
        } catch (error) {
          if (error instanceof EmailSizeLimitError) {
            await record(id, false);
            skipped++;
            continue;
          }
          throw error;
        }
        const type = inboundContentType(file);
        if (bytes.length !== file.size || !validInboundBytes(bytes, type)) {
          await record(id, false);
          skipped++;
          continue;
        }
        const upload = await database.storage
          .from('ticket-attachments')
          .upload(inboundStoragePath(job, id), bytes, { contentType: type, upsert: false });
        if (upload.error && String((upload.error as { statusCode?: string }).statusCode) !== '409')
          throw upload.error;
        // Keep the object on uncertain database responses. A retry reuses the same path.
        await record(id, true, file, bytes.length);
        total += bytes.length;
        imported++;
      }
      success = true;
    } catch {
      failed++;
    }
    const finished = await database.rpc('finish_inbound_attachments', {
      job_id: job.id,
      token: job.lease_token,
      success,
    });
    if (finished.error || !finished.data)
      throw finished.error ?? new Error('Attachment acknowledgement failed');
  }
  return { processed: jobs.length, imported, skipped, failed };
}
