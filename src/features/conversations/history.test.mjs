import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { historyCursor, historyFilter, historyPage, recentMessages } from './history.ts';
import { load } from '../../../tests/helpers/load-module.mjs';

const timestamp = '2026-09-27T14:00:00.123456+00:00';
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const rows = Array.from({ length: 1205 }, (_, index) => ({ id: id(index), created_at: timestamp, author_id: 'author', kind: 'reply', body: `Message ${index}` })).reverse();

test('cursor pagination traverses more than the API row cap, including tied timestamps', () => {
  const seen = [];
  let remaining = rows;
  while (remaining.length) {
    const page = historyPage(remaining.slice(0, 51));
    seen.push(...page.items.map(row => row.id));
    if (!page.older) break;
    assert.match(historyFilter(page.older), /\.123456\+00:00/);
    const cutoff = page.older.split('|')[1];
    remaining = rows.filter(row => row.id < cutoff);
  }
  assert.equal(seen.length, 1205);
  assert.equal(new Set(seen).size, 1205);
  assert.deepEqual(recentMessages(rows).map(row => row.id), rows.slice(0, 50).toReversed().map(row => row.id));
});

test('cursors preserve full precision and reject injected filters and repeated parameters', () => {
  assert.equal(historyCursor(rows[0]), `${timestamp}|${id(1204)}`);
  assert.equal(historyFilter(undefined), null);
  for (const cursor of ['garbage', `${timestamp}|bad`, `${timestamp}|1),id.gt.0`, `${timestamp}|1|extra`, ['1', '2']]) {
    assert.throws(() => historyFilter(cursor), /Invalid history cursor/);
  }
  assert.match(historyFilter(`${timestamp}|123`), /id.lt.123/);
});

function setup(role, parent = { data: { id: 'parent', requester_id: 'viewer' }, error: null }, manager = false) {
  const calls = [];
  let signed = 0;
  const query = table => {
    const builder = new Proxy({}, { get: (_, key) => {
      if (key === 'then') return resolve => Promise.resolve({ data: table === 'profiles' ? [{ user_id: 'author', display_name: 'Support' }] : rows.slice(0, 51), error: null }).then(resolve);
      if (key === 'maybeSingle') return async () => parent;
      return (...args) => { calls.push([table, key, ...args]); return builder; };
    } });
    return builder;
  };
  const { HistoryBrowser } = load('src/features/conversations/history-browser.tsx', {
    '@/features/inventory/access': { inventoryAccess: async () => ({ manager, departments: [] }) },
    'next/link': { default: props => React.createElement('a', props) },
    'next/navigation': { notFound: () => { throw Error('NOT_FOUND'); } },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'org', id: 'viewer' }) },
    '@/lib/supabase/server': { createClient: async () => ({ from: query, storage: { from: () => ({ createSignedUrls: async paths => { signed += paths.length; return { data: [] }; } }) } }) },
  });
  return { calls, signed: () => signed, render: (filters = {}) => HistoryBrowser({ kind: 'ticket', id: 'parent', filters }) };
}

test('history queries enforce ownership, tenant scope, audience, ordering and bounded pages', async () => {
  const { calls, render } = setup('end_user');
  const html = renderToStaticMarkup(await render({ before: historyCursor(rows[0]) }));
  const messages = calls.filter(call => call[0] === 'ticket_messages');
  assert.ok(messages.some(call => call[1] === 'eq' && call[2] === 'organization_id' && call[3] === 'org'));
  assert.ok(messages.some(call => call[1] === 'eq' && call[2] === 'ticket_id' && call[3] === 'parent'));
  assert.ok(messages.some(call => call[1] === 'neq' && call[2] === 'kind' && call[3] === 'internal_note'));
  assert.ok(messages.some(call => call[1] === 'limit' && call[2] === 51));
  assert.deepEqual(messages.filter(call => call[1] === 'order').map(call => call[2]), ['created_at', 'id']);
  assert.match(html, /Earlier messages/);
  assert.match(html, /Latest entries/);
  assert.doesNotMatch(html, />Activity</);
  assert.equal((html.match(/class="conversation-bubble"/g) ?? []).length, 50);
});

test('history rejects another requester and distinguishes unavailable from missing', async () => {
  await assert.rejects(setup('end_user', { data: { requester_id: 'other' }, error: null }).render(), /NOT_FOUND/);
  await assert.rejects(setup('technician', { data: null, error: { message: 'offline' } }).render(), /unavailable/);
  await assert.rejects(setup('technician', { data: null, error: null }).render(), /NOT_FOUND/);
});

test('file history signs only the displayed page and provides an archive cursor', async () => {
  const { render, signed } = setup('technician');
  const html = renderToStaticMarkup(await render({ view: 'files' }));
  assert.equal(signed(), 50);
  assert.match(html, /Earlier files/);
  assert.match(html, /Link unavailable/);
});

test('employee inventory managers can read linked inventory history without internal notes or unrelated support access', async () => {
  const allowed = setup('end_user', {data:{id:'parent',requester_id:'other',request_kind:'inventory'},error:null}, true);
  const html = renderToStaticMarkup(await allowed.render());
  assert.ok(allowed.calls.some(call => call[0] === 'ticket_messages' && call[1] === 'neq' && call[3] === 'internal_note'));
  assert.doesNotMatch(html, />Activity</);
  await assert.rejects(setup('end_user', {data:{requester_id:'other',request_kind:'support'},error:null}, true).render(), /NOT_FOUND/);
  await assert.rejects(setup('end_user', {data:{requester_id:'other',request_kind:'inventory'},error:null}, false).render(), /NOT_FOUND/);
});
