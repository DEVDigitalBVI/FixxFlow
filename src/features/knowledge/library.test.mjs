import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const id = '10000000-0000-4000-8000-000000000001';
const article = {
  id,
  organization_id: null,
  title: 'Shared Wi-Fi guide',
  summary: 'Reconnect to Wi-Fi.',
  content: [
    { type: 'heading', text: 'Start here' },
    { type: 'paragraph', text: 'Check your connection.' },
    { type: 'heading', text: 'Next steps' },
  ],
  audience: 'employees',
  category: 'Network',
  status: 'published',
  related_article_ids: [],
  revision: 1,
};
const link = { default: (props) => React.createElement('a', props) };

test('library editor uses owner action, preserves drafts on failure and returns to owner list after saving', async () => {
  const calls = [],
    routes = [];
  let succeed = false;
  const frames = [];
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return 0;
  };
  const h = componentHarness(
    'src/features/knowledge/article-editor.tsx',
    'ArticleEditor',
    {
      article: { ...article, organization_id: '' },
      organizationId: '',
      assets: [],
      related: [],
      library: true,
      saveAction: async (form) => {
        calls.push(JSON.parse(form.get('content')));
        return succeed ? { id } : { error: 'Retry without losing your work.' };
      },
    },
    {
      'next/navigation': { useRouter: () => ({ push: (p) => routes.push(p), refresh() {} }) },
      '@/lib/supabase/client': {
        createClient() {
          throw Error('No tenant uploads');
        },
      },
      '@/app/app/help/actions': {
        saveArticle() {
          throw Error('No tenant writes');
        },
      },
    },
  );
  try {
    assert.equal(h.all((n) => n.type === 'input' && n.props.type === 'file').length, 0);
    assert.equal(h.all((n) => n.type === 'option' && n.props.value === 'image').length, 0);
    assert.ok(
      h.all((n) => n.type === 'button' && n.props['aria-label'] === 'Move block 1 down').length,
    );
    const text = h.find((n) => n.type === 'textarea');
    text.props.onChange({ target: { value: 'Preserved draft' } });
    h.render();
    await h.find((n) => n.type === 'form').props.action(new FormData());
    h.render();
    frames.splice(0).forEach((fn) => fn());
    assert.equal(routes.length, 0);
    assert.ok(h.find((n) => n.props.role === 'alert'));
    assert.equal(h.find((n) => n.type === 'textarea').props.value, 'Preserved draft');
    assert.ok(h.focuses.length, 'error receives focus');
    succeed = true;
    await h.find((n) => n.type === 'form').props.action(new FormData());
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(routes, [`/platform/library?saved=${id}`]);
  } finally {
    h.close();
    globalThis.requestAnimationFrame = previous;
  }
});

test('owner action authorizes before reading input or accessing data', async () => {
  const { saveLibraryArticle } = load('src/app/platform/library/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/platform': {
      requirePlatformOwner: async () => {
        throw Error('DENIED');
      },
    },
    '@/lib/supabase/server': {
      createClient() {
        throw Error('Must not access database');
      },
    },
  });
  await assert.rejects(saveLibraryArticle(new FormData()), /DENIED/);
});

test('shared reader identifies provenance, renders semantic contents and has no tenant edit or feedback controls', async () => {
  const { LibraryArticleDetail } = load('src/features/knowledge/library-article-detail.tsx', {
    'next/link': link,
    '@/lib/supabase/server': { createClient: async () => ({}) },
  });
  const html = renderToStaticMarkup(await LibraryArticleDetail({ article }));
  assert.match(html, /<h1>Shared Wi-Fi guide<\/h1>/);
  assert.match(html, /FixxFlow library/);
  assert.match(html, /aria-label="On this page"/);
  assert.match(html, /href="\/app\/tickets\/new"/);
  assert.doesNotMatch(html, /Edit article|Was this helpful/);
});

test('owner listing paginates and exposes search labels, explicit audiences, recoverable errors and save receipt', async () => {
  for (const fail of [false, true]) {
    const query = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'then'
            ? (resolve) =>
                Promise.resolve({ data: [article], error: fail ? {} : null }).then(resolve)
            : () => query,
      },
    );
    const Page = load('src/app/platform/library/page.tsx', {
      'next/link': link,
      'next/navigation': searchNavigation,
      '@/lib/auth/platform': { requirePlatformOwner: async () => ({ id: 'owner' }) },
      '@/lib/supabase/server': {
        createClient: async () => ({ from: () => query, rpc: () => query }),
      },
    }).default;
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ q: 'Wi-Fi', page: '2', saved: id }) }),
    );
    assert.match(html, /Search shared articles/);
    assert.match(html, /role="status">Shared article saved/);
    if (fail) assert.match(html, /role="alert"[\s\S]*Try again/);
    else {
      assert.match(html, /Employee-facing/);
      assert.match(html, /Previous/);
      assert.match(html, new RegExp(`/platform/library/${id}/edit`));
    }
  }
});
