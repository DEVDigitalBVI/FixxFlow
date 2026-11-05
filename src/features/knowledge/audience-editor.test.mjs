import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

test('audience choice and revision remain with a failed draft across refreshes', async () => {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };
  const props = {
    organizationId: 'org',
    article: {
      id: 'article',
      title: 'Draft',
      content: [{ type: 'paragraph', text: 'Steps' }],
      audience: 'it_only',
      related_article_ids: [],
      revision: 2,
    },
    assets: [],
    related: [],
  };
  const h = componentHarness('src/features/knowledge/article-editor.tsx', 'ArticleEditor', props, {
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
    '@/lib/supabase/client': { createClient: () => ({}) },
    '@/app/app/help/actions': { saveArticle: async () => ({ error: 'Please retry' }) },
  });
  try {
    const control = h.find((n) => n.props.name === 'audience');
    assert.equal(control.props.required, true);
    assert.equal(control.props.value, 'it_only');
    control.props.onChange({ target: { value: 'employees' } });
    h.render();
    await h.submit(new FormData());
    h.render();
    assert.equal(h.find((n) => n.props.name === 'audience').props.value, 'employees');
    props.article = { ...props.article, revision: 3, audience: 'it_only' };
    h.render();
    assert.equal(h.find((n) => n.props.name === 'audience').props.value, 'employees');
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 2);
  } finally {
    h.close();
    globalThis.requestAnimationFrame = previous;
  }
});

test('failed article actions preserve every controlled metadata field and the original revision for retry', async () => {
  const previous = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return 0;
  };
  try {
    for (const throws of [false, true]) {
      const captured = [];
      const props = {
        organizationId: 'org',
        library: true,
        article: {
          id: 'article',
          title: 'Original title',
          category: 'Network',
          summary: 'Original summary',
          status: 'draft',
          help_collection: 'fixxflow',
          help_topic: 'getting-started',
          help_format: 'guide',
          audience: 'it_only',
          content: [{ type: 'paragraph', text: 'Steps' }],
          related_article_ids: [],
          revision: 2,
        },
        assets: [],
        related: [],
        saveAction: async (form) => {
          captured.push(Object.fromEntries(form));
          if (throws) throw new Error('offline');
          return { error: 'Retry without losing your work.' };
        },
      };
      const h = componentHarness(
        'src/features/knowledge/article-editor.tsx',
        'ArticleEditor',
        props,
        {
          'next/navigation': {
            useRouter: () => ({
              push() {
                throw Error('No navigation on failure');
              },
              refresh() {},
            }),
          },
          '@/lib/supabase/client': { createClient: () => ({}) },
        },
      );
      try {
        const edits = {
          title: 'Edited title',
          summary: 'Edited summary',
          category: 'Email',
          status: 'published',
          helpTopic: 'requests',
          helpFormat: 'faq',
        };
        for (const [name, value] of Object.entries(edits)) {
          h.find((n) => n.props.name === name).props.onChange({ target: { value } });
          h.render();
        }
        const data = () => {
          const form = new FormData();
          for (const control of h.all((n) => n.props.name && n.props.value !== undefined))
            form.set(control.props.name, control.props.value);
          return form;
        };
        assert.equal(h.find((n) => n.type === 'form').props.action, undefined);
        await h.submit(data());
        h.render();
        frames.splice(0).forEach((fn) => fn());
        assert.ok(h.find((n) => n.props.role === 'alert'));
        assert.ok(h.focuses.length, 'returned and thrown failures focus the error');
        // React resets uncontrolled fields after an action resolves. Controlled
        // values must still hold the draft when it commits that reset or a refresh.
        props.article = { ...props.article, title: 'Other editor title', revision: 3 };
        h.render();
        for (const [name, value] of Object.entries(edits)) {
          const control = h.find((n) => n.props.name === name);
          assert.equal(control.props.value, value);
          assert.equal(control.props.defaultValue, undefined);
        }
        assert.equal(h.find((n) => n.props.name === 'revision').props.value, 2);
        await h.submit(data());
        frames.splice(0).forEach((fn) => fn());
        assert.deepEqual(captured[0], captured[1]);
      } finally {
        h.close();
      }
    }
  } finally {
    globalThis.requestAnimationFrame = previous;
  }
});

test('article submission blocks overlapping requests and permits retry after a handled failure', async () => {
  let complete;
  let calls = 0;
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
      organizationId: 'org',
      assets: [],
      related: [],
      article: { id: 'article', title: 'Title', content: [], related_article_ids: [], revision: 1 },
      saveAction: async () => {
        calls++;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
    { 'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) } },
  );
  try {
    const first = h.submit(new FormData());
    await h.submit(new FormData());
    assert.equal(calls, 1);
    complete({ error: 'Please retry' });
    await first;
    h.render();
    frames.splice(0).forEach((fn) => fn());
    const retry = h.submit(new FormData());
    assert.equal(calls, 2);
    complete({ error: 'Still unavailable' });
    await retry;
  } finally {
    h.close();
    globalThis.requestAnimationFrame = previous;
  }
});
