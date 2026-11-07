import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { TicketAttachmentList, ticketAttachmentUrls } = load(
  'src/features/tickets/ticket-attachment-list.tsx',
  {
    '@/components/ui/retry-button': {
      RetryButton: ({ label }) => React.createElement('button', { type: 'button' }, label),
    },
    '@/features/timezones/provider': { Timestamp: ({ value }) => value },
  },
);
const files = ['one', 'two'].map((id) => ({
  id,
  storage_path: id,
  file_name: `${id}.txt`,
  size_bytes: 100,
  created_at: '2026-11-04T10:00:00Z',
  is_internal: id === 'two',
}));
function database(response) {
  return {
    storage: {
      from: (bucket) => {
        assert.equal(bucket, 'ticket-attachments');
        return {
          createSignedUrls: async (paths, lifetime) => {
            assert.deepEqual(paths, ['one', 'two']);
            assert.equal(lifetime, 3600);
            if (response instanceof Error) throw response;
            return response;
          },
        };
      },
    },
  };
}
test('partial signing failures keep successful downloads and expose a named retry without inert links', async () => {
  const urls = await ticketAttachmentUrls(
    database({
      error: null,
      data: [
        { path: 'one', signedUrl: 'https://storage.example/one', error: null },
        { path: 'two', signedUrl: '', error: 'unavailable' },
      ],
    }),
    ['one', 'two'],
  );
  for (const staff of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(TicketAttachmentList, { files, urls, staff }),
    );
    assert.equal((html.match(/<a /g) ?? []).length, 1);
    assert.match(html, /href="https:\/\/storage.example\/one"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /<button type="button">Retry downloads<\/button>/);
    assert.match(html, /two.txt/);
    assert.match(html, /Download unavailable/);
    assert.equal(html.includes('Internal email attachment'), staff);
  }
});
test('batch errors, thrown errors and missing object signatures preserve metadata and allow retry recovery', async () => {
  for (const response of [
    { error: { message: 'outage' }, data: null },
    new Error('offline'),
    { error: null, data: [] },
  ]) {
    const urls = await ticketAttachmentUrls(database(response), ['one', 'two']);
    const html = renderToStaticMarkup(React.createElement(TicketAttachmentList, { files, urls }));
    assert.doesNotMatch(html, /<a /);
    assert.match(html, /Retry downloads/);
    assert.match(html, /one.txt/);
  }
  const urls = await ticketAttachmentUrls(
    database({
      error: null,
      data: files.map((file) => ({
        path: file.storage_path,
        signedUrl: `https://storage.example/${file.id}`,
        error: null,
      })),
    }),
    ['one', 'two'],
  );
  const html = renderToStaticMarkup(React.createElement(TicketAttachmentList, { files, urls }));
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.doesNotMatch(html, /role="alert"|Retry downloads|Download unavailable/);
  assert.deepEqual(await ticketAttachmentUrls({}, []), new Map());
});
test('metadata failures provide recovery without claiming an empty attachment list', () => {
  const html = renderToStaticMarkup(
    React.createElement(TicketAttachmentList, { files: [], urls: new Map(), error: true }),
  );
  assert.match(html, /Attachments could not load/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No files attached/);
});
