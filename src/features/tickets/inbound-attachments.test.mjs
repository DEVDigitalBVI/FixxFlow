import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const {
  processInboundAttachments,
  validInboundBytes,
  validInboundMetadata,
  inboundStoragePath,
  inboundFileName,
} = load('src/features/tickets/inbound-attachments.ts', { 'server-only': {} });
const job = {
  id: '10000000-0000-4000-8000-000000000001',
  lease_token: 'token',
  organization_id: 'org',
  ticket_id: 'ticket',
  sender_id: 'sender',
  provider_email_id: 'email',
  attachment_ids: ['file'],
  processed_ids: [],
  total_bytes: 0,
};
const bytes = new TextEncoder().encode('Log entry: VPN disconnected\n');
const file = {
  id: 'file',
  filename: 'vpn.log',
  content_type: 'application/octet-stream',
  size: bytes.length,
  content_disposition: 'attachment',
  download_url: 'https://inbound-cdn.resend.com/email/attachments/file?signature=fixture',
};
function harness({
  metadata = file,
  payload = bytes,
  hostFailure = false,
  registrationFailure = false,
} = {}) {
  const calls = [],
    objects = new Set(),
    records = new Set();
  let fail = registrationFailure;
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'claim_inbound_attachments')
        return { data: [{ ...job, processed_ids: [...records] }], error: null };
      if (name === 'record_inbound_attachment') {
        if (fail) {
          fail = false;
          throw Error('Lost database response');
        }
        records.add(args.provider_attachment_id);
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, data, options) => {
          calls.push(['upload', bucket, path, options]);
          if (objects.has(path)) return { error: { statusCode: '409' } };
          objects.add(path);
          return { error: null };
        },
      }),
    },
  };
  const request = async (url, options) => {
    calls.push(['fetch', String(url), options]);
    if (String(url).startsWith('https://api.resend.com/'))
      return new Response(JSON.stringify(metadata));
    if (hostFailure) throw Error('Network unavailable');
    return new Response(payload);
  };
  return {
    calls,
    objects,
    records,
    run: () => processInboundAttachments('api-key', { database: db, request, now: () => 0 }),
  };
}
test('attachments validate MIME, extension and bytes, accept text logs, and reject executable or inline content', () => {
  assert.equal(validInboundMetadata(file), true);
  for (const bad of [
    { ...file, filename: 'payload.exe' },
    { ...file, content_disposition: 'inline' },
    { ...file, content_type: 'text/html' },
    { ...file, size: 10485761 },
  ])
    assert.equal(validInboundMetadata(bad), false);
  assert.equal(validInboundBytes(bytes, 'text/plain'), true);
  assert.equal(validInboundBytes(new Uint8Array([0, 1, 2]), 'text/plain'), false);
  assert.equal(validInboundBytes(bytes, 'image/png'), false);
  assert.equal(validInboundBytes(bytes, 'application/pdf'), false);
  assert.equal(inboundFileName('../../folder/log\u202e.txt'), 'log.txt');
  assert.equal(inboundStoragePath(job, 'file'), inboundStoragePath(job, 'file'));
  assert.ok(!inboundStoragePath(job, 'file').includes(file.filename));
});
test('worker uploads to the private ticket bucket and registers the canonical file path once', async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { processed: 1, imported: 1, skipped: 0, failed: 0 });
  assert.equal(h.objects.size, 1);
  const upload = h.calls.find((c) => c[0] === 'upload');
  assert.equal(upload[1], 'ticket-attachments');
  assert.equal(upload[2], inboundStoragePath(job, 'file'));
  assert.equal(upload[3].upsert, false);
  assert.equal(upload[3].contentType, 'text/plain');
  assert.equal(
    h.calls.find((c) => c[0] === 'record_inbound_attachment')[1].content_type,
    'text/plain',
  );
  assert.equal(h.calls.at(-1)[1].success, true);
});
test('retry after uncertain registration reuses storage safely and completed files are not reimported', async () => {
  const h = harness({ registrationFailure: true });
  assert.equal((await h.run()).failed, 1);
  assert.equal(h.objects.size, 1);
  assert.equal((await h.run()).imported, 1);
  assert.equal(h.objects.size, 1);
  const requests = h.calls.filter((c) => c[0] === 'fetch').length;
  assert.equal((await h.run()).imported, 0);
  assert.equal(h.calls.filter((c) => c[0] === 'fetch').length, requests);
});
test('unsupported files, mismatched signatures and oversized streaming responses are skipped without upload', async () => {
  for (const options of [
    { metadata: { ...file, content_disposition: 'inline' } },
    { metadata: { ...file, content_type: 'image/png', filename: 'fake.png' } },
    { payload: new Uint8Array(10485761) },
  ]) {
    const h = harness(options);
    assert.equal((await h.run()).skipped, 1);
    assert.equal(h.objects.size, 0);
    assert.equal(h.calls.at(-1)[1].success, true);
  }
});
test('untrusted download destinations are never fetched and transient failures remain retryable', async () => {
  const h = harness({ metadata: { ...file, download_url: 'https://127.0.0.1/private' } });
  assert.equal((await h.run()).failed, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'fetch').length, 1);
  assert.equal(h.objects.size, 0);
  assert.equal(h.calls.at(-1)[1].success, false);
  const network = harness({ hostFailure: true });
  assert.equal((await network.run()).failed, 1);
  assert.equal(network.calls.at(-1)[1].success, false);
});

test('inline screenshot permission does not allow small trackers or signature logos', () => {
  const screenshot = {
    ...file,
    filename: 'screenshot.png',
    content_type: 'image/png',
    content_disposition: 'inline',
    size: 5000,
  };
  assert.equal(validInboundMetadata(screenshot, true), true);
  assert.equal(validInboundMetadata({ ...screenshot, size: 100 }, true), false);
  assert.equal(validInboundMetadata({ ...screenshot, filename: 'company-logo.png' }, true), false);
  assert.equal(validInboundMetadata(screenshot), false);
});
