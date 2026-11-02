import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const id = '10000000-0000-4000-8000-000000000001';
const row = {
  id,
  title: 'How do I use teams?',
  summary: 'Quick explanation.',
  content: [{ type: 'paragraph', text: 'Teams group IT work.' }],
  help_collection: 'fixxflow',
  help_topic: 'getting-started',
  help_format: 'faq',
  audience: 'employees',
  organization_id: null,
  status: 'published',
  category: 'Software',
  related_article_ids: [],
};
const mocks = {
  'next/link': { default: (props) => React.createElement('a', props) },
  'next/navigation': {
    ...searchNavigation,
    notFound() {
      throw Error('NOT_FOUND');
    },
    redirect(path) {
      throw Error('REDIRECT:' + path);
    },
  },
};
function page(role = 'end_user', rows = [row], error = null) {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) => Promise.resolve({ data: rows, error }).then(resolve)
          : (...args) => {
              calls.push([key, ...args]);
              return builder;
            },
    },
  );
  const Page = load('src/app/app/faq/page.tsx', {
    ...mocks,
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'viewer-org' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: (name) => {
          calls.push(['from', name]);
          return builder;
        },
        rpc: (name, args) => {
          calls.push(['rpc', name, args]);
          return builder;
        },
      }),
    },
  }).default;
  return {
    calls,
    render: async (filters) => render(await Page({ searchParams: Promise.resolve(filters ?? {}) })),
  };
}
test('FAQ collection is separate, employee scoped and uses native accessible question disclosures', async () => {
  const p = page();
  const html = await p.render({ audience: 'it_only', view: 'all' });
  assert.match(html, /<h1>FixxFlow Help &amp; FAQ<\/h1>/);
  assert.match(html, /<details class="fixxflow-faq-item"><summary>How do I use teams\?/);
  assert.match(html, /Teams group IT work/);
  assert.match(html, new RegExp(`/app/faq/${id}`));
  assert.ok(p.calls.some((c) => c[0] === 'eq' && c[1] === 'audience' && c[2] === 'employees'));
  assert.ok(p.calls.some((c) => c[0] === 'eq' && c[1] === 'status' && c[2] === 'published'));
  assert.ok(
    p.calls.some((c) => c[0] === 'eq' && c[1] === 'help_collection' && c[2] === 'fixxflow'),
  );
  assert.doesNotMatch(html, /For IT support/);
});
test('staff audience, topic and search filters persist across pagination', async () => {
  const p = page(
    'technician',
    Array.from({ length: 25 }, (_, i) => ({
      ...row,
      id: id.slice(0, -2) + String(i).padStart(2, '0'),
    })),
  );
  const html = await p.render({
    q: 'teams',
    topic: 'administration',
    audience: 'it_only',
    format: 'faq',
    page: '2',
  });
  assert.ok(
    p.calls.some(
      (c) =>
        c[0] === 'rpc' &&
        c[1] === 'search_knowledge_articles' &&
        c[2].target_organization_id === 'viewer-org',
    ),
  );
  assert.ok(p.calls.some((c) => c[0] === 'eq' && c[1] === 'audience' && c[2] === 'it_only'));
  assert.ok(p.calls.some((c) => c[0] === 'range' && c[1] === 24 && c[2] === 48));
  assert.match(
    html,
    /q=teams&amp;topic=administration&amp;audience=it_only&amp;format=faq&amp;page=3/,
  );
});
test('FAQ distinguishes empty results from errors and provides recovery', async () => {
  assert.match(await page('end_user', []).render({ q: 'missing' }), /No FixxFlow help found/);
  const html = await page('end_user', null, {}).render({ q: 'teams' });
  assert.match(html, /role="alert"/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No FixxFlow help found/);
});
test('Knowledge base queries explicitly exclude the FixxFlow collection', async () => {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) => Promise.resolve({ data: [], error: null }).then(resolve)
          : (...args) => {
              calls.push([key, ...args]);
              return builder;
            },
    },
  );
  const Page = load('src/app/app/help/page.tsx', {
    ...mocks,
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role: 'end_user', organizationId: 'org' }),
    },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => builder }) },
  }).default;
  const html = render(await Page({ searchParams: Promise.resolve({}) }));
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'help_collection' && c[2] === 'knowledge'));
  assert.match(html, /href="\/app\/faq"/);
});
test('old product article links redirect to their canonical FAQ destination', async () => {
  const builder = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) => Promise.resolve({ data: row, error: null }).then(resolve)
          : () => builder,
    },
  );
  const Page = load('src/app/app/help/[articleId]/page.tsx', {
    ...mocks,
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role: 'end_user', organizationId: 'org' }),
    },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => builder }) },
  }).default;
  await assert.rejects(
    Page({ params: Promise.resolve({ articleId: id }) }),
    new RegExp('REDIRECT:/app/faq/' + id),
  );
});
