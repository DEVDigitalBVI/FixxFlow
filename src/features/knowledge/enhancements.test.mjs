import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const id = '10000000-0000-4000-8000-000000000001';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test('related picker keeps selected guides across pages, searches and failed requests', async () => {
  const previous = globalThis.fetch;
  let fail = false;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return fail
      ? new Response('', { status: 503 })
      : Response.json({
          rows: [{ id: 'second', title: 'Second guide', audience: 'employees' }],
          more: true,
        });
  };
  const h = componentHarness(
    'src/features/knowledge/related-article-picker.tsx',
    'RelatedArticlePicker',
    { articleId: id, initial: [{ id: 'selected', title: 'Saved guide' }] },
  );
  try {
    h.render();
    await tick();
    h.render();
    assert.equal(
      h.find((node) => node.type === 'input' && node.props.name === 'related').props.value,
      'selected',
    );
    h.find(
      (node) => node.type === 'input' && node.props.type === 'checkbox' && !node.props.checked,
    ).props.onChange();
    h.render();
    assert.equal(h.all((node) => node.type === 'input' && node.props.name === 'related').length, 2);
    h.find((node) => node.type === 'button' && node.props.children === 'Next').props.onClick();
    h.render();
    await tick();
    h.render();
    assert.match(calls.at(-1).url, /page=2/);
    assert.equal(h.all((node) => node.type === 'input' && node.props.name === 'related').length, 2);
    fail = true;
    h.find((node) => node.type === 'input' && node.props.type === 'search').props.onChange({
      target: { value: 'no match' },
    });
    h.render();
    await new Promise((resolve) => setTimeout(resolve, 270));
    h.render();
    assert.equal(h.all((node) => node.type === 'input' && node.props.name === 'related').length, 2);
    assert.ok(h.find((node) => node.props.role === 'alert'));
    let prevented = false;
    h.find((node) => node.type === 'input' && node.props.type === 'search').props.onKeyDown({
      key: 'Enter',
      preventDefault() {
        prevented = true;
      },
    });
    assert.ok(prevented, 'Enter cannot accidentally publish the article');
  } finally {
    h.close();
    globalThis.fetch = previous;
  }
});
test('article choices search the whole tenant collection with stable pagination and role guards', async () => {
  let role = 'technician',
    ownerChecks = 0;
  const calls = [];
  const query = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) =>
              Promise.resolve({
                data: Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: 'Guide' })),
                error: null,
              }).then(resolve)
          : (...args) => {
              calls.push([key, ...args]);
              return query;
            },
    },
  );
  const { articleChoices } = load('src/features/knowledge/choices.ts', {
    'server-only': {},
    '@/lib/auth/viewer': { requireViewer: async () => ({ organizationId: 'trusted-org', role }) },
    '@/lib/auth/platform': {
      requirePlatformOwner: async () => {
        ownerChecks++;
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: (table) => {
          calls.push(['from', table]);
          return query;
        },
      }),
    },
  });
  const result = await articleChoices(new URLSearchParams({ q: '%VPN_', page: '10', exclude: id }));
  assert.equal(result.rows.length, 24);
  assert.equal(result.more, true);
  assert.ok(
    calls.some(
      (call) => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'trusted-org',
    ),
  );
  assert.ok(calls.some((call) => call[0] === 'range' && call[1] === 216 && call[2] === 240));
  assert.ok(calls.some((call) => call[0] === 'ilike' && call[2] === '%\\%VPN\\_%'));
  const before = calls.length;
  role = 'end_user';
  await assert.rejects(articleChoices(new URLSearchParams()));
  assert.equal(calls.length, before);
  await articleChoices(new URLSearchParams({ scope: 'library' }));
  assert.equal(ownerChecks, 1);
  await assert.rejects(articleChoices(new URLSearchParams({ scope: 'foreign' })));
});
test('suggestion endpoint derives organization from the viewer, separates empty matches and failures, and never caches private results', async () => {
  let fail = false;
  const calls = [];
  const { GET } = load('src/app/app/help/suggestions/route.ts', {
    'next/navigation': { ...searchNavigation, unstable_rethrow: () => {} },
    '@/lib/auth/viewer': { requireViewer: async () => ({ organizationId: 'trusted-org' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return fail ? { error: new Error('private error') } : { data: [], error: null };
        },
      }),
    },
    '@/lib/server-errors': { reportServerError() {} },
  });
  const empty = await GET(
    new Request('https://example.test/app/help/suggestions?q=unrelated&org=forged'),
  );
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { rows: [] });
  assert.equal(empty.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(calls[0][1].org, 'trusted-org');
  fail = true;
  const unavailable = await GET(new Request('https://example.test/app/help/suggestions?q=printer'));
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private error/);
});
