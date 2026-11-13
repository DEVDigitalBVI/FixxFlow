import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ content, save, uploadError = null, library = false } = {}) {
  const pushes = [],
    guards = [],
    uploads = [],
    registrations = [],
    focused = [];
  let released = 0,
    discard = false;
  const props = {
    article: {
      id: 'article',
      revision: 7,
      title: 'VPN help',
      category: 'Network',
      summary: '',
      status: 'draft',
      audience: 'employees',
      content: content ?? [
        { type: 'paragraph', text: 'First' },
        { type: 'paragraph', text: 'Second' },
      ],
      related_article_ids: [],
    },
    organizationId: 'org',
    assets: [],
    related: [],
    library,
    saveAction: save ?? (async () => ({ id: 'article' })),
  };
  const h = componentHarness('src/features/knowledge/article-editor.tsx', 'ArticleEditor', props, {
    'next/navigation': { useRouter: () => ({ push: (path) => pushes.push(path), refresh() {} }) },
    '@/app/app/help/actions': { saveArticle: props.saveAction },
    '@/components/ui/unsaved-changes': {
      useUnsavedChanges: (dirty) => {
        guards.push(dirty);
        return () => released++;
      },
      confirmDiscardChanges: () => discard,
    },
    '@/lib/supabase/client': {
      createClient: () => ({
        storage: {
          from: () => ({
            upload: async (...args) => {
              uploads.push(args);
              return { error: uploadError };
            },
            remove: async () => ({ error: null }),
          }),
        },
        from: () => ({
          insert: (row) => {
            registrations.push(row);
            return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
          },
        }),
      }),
    },
  });
  const oldFrame = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  const render = () => {
    h.render();
    frames.splice(0).forEach((fn) => fn());
    h.all((node) => node.type === 'textarea' && !node.props.name).forEach((node, i) =>
      node.props.ref({ selectionStart: 0, selectionEnd: 5, focus: () => focused.push(i) }),
    );
  };
  const button = (label) =>
    h.find((node) => node.type === 'button' && node.props.children === label);
  const text = () =>
    h.all((node) => node.type === 'textarea' && !node.props.name).map((node) => node.props.value);
  render();
  return {
    h,
    props,
    pushes,
    guards,
    uploads,
    registrations,
    focused,
    render,
    button,
    text,
    released: () => released,
    allowDiscard: () => {
      discard = true;
    },
    close() {
      h.close();
      globalThis.requestAnimationFrame = oldFrame;
    },
  };
}
test('article sections add, reorder and remove with confirmation and focus on the moved section', () => {
  const f = fixture();
  try {
    f.h.find((node) => node.props['aria-label'] === 'Move block 2 up').props.onClick();
    f.render();
    assert.deepEqual(f.text(), ['Second', 'First']);
    assert.deepEqual(f.focused, [0]);
    f.button('Add paragraph').props.onClick();
    f.render();
    assert.deepEqual(f.text(), ['Second', 'First', '']);
    window.confirm = () => false;
    f.h.find((node) => node.props['aria-label'] === 'Remove block 1').props.onClick();
    f.render();
    assert.equal(f.text().length, 3);
    window.confirm = () => true;
    f.h.find((node) => node.props['aria-label'] === 'Remove block 1').props.onClick();
    f.render();
    assert.deepEqual(f.text(), ['First', '']);
    assert.equal(f.guards.at(-1), true);
  } finally {
    f.close();
  }
});
test('article formatting wraps selected text in the existing bold and italic markers', () => {
  const f = fixture();
  try {
    f.button('Bold').props.onClick();
    f.render();
    assert.equal(f.text()[0], '**First**');
    f.h
      .find((node) => node.type === 'textarea' && !node.props.name)
      .props.ref({ selectionStart: 2, selectionEnd: 7, focus() {} });
    f.button('Italic').props.onClick();
    f.render();
    assert.equal(f.text()[0], '***First***');
  } finally {
    f.close();
  }
});
test('article cancel requires discarding a dirty draft and retains the original revision after a refresh', () => {
  const f = fixture();
  try {
    f.button('Add paragraph').props.onClick();
    f.render();
    f.button('Cancel').props.onClick();
    assert.deepEqual(f.pushes, []);
    f.props.article = { ...f.props.article, revision: 8 };
    f.render();
    assert.equal(f.h.find((node) => node.props.name === 'revision').props.value, 7);
    f.allowDiscard();
    f.button('Cancel').props.onClick();
    assert.deepEqual(f.pushes, ['/app/help/article']);
  } finally {
    f.close();
  }
});
test('article stale saves preserve content and protection, focus feedback, and permit retry', async () => {
  const calls = [];
  let conflict = true;
  const f = fixture({
    save: async (form) => {
      calls.push(Object.fromEntries(form));
      return conflict ? { error: 'Article changed. Review and retry.' } : { id: 'article' };
    },
  });
  try {
    f.button('Add paragraph').props.onClick();
    f.render();
    await f.h.submit(new FormData());
    f.render();
    assert.equal(JSON.parse(calls[0].content).length, 3);
    assert.deepEqual(f.pushes, []);
    assert.equal(f.released(), 0);
    assert.match(f.h.find((node) => node.props.role === 'alert').props.children, /Article changed/);
    assert.equal(f.h.focuses.length, 1);
    assert.equal(f.guards.at(-1), true);
    conflict = false;
    await f.h.submit(new FormData());
    f.render();
    assert.deepEqual(f.pushes, ['/app/help/article']);
    assert.equal(f.released(), 1);
    assert.equal(f.guards.at(-1), false);
  } finally {
    f.close();
  }
});
test('article save rejects duplicate in-flight submissions and recovers from a thrown failure', async () => {
  let fail,
    calls = 0;
  const f = fixture({
    save: () => {
      calls++;
      return new Promise((_, reject) => {
        fail = reject;
      });
    },
  });
  try {
    const pending = f.h.submit(new FormData());
    await f.h.submit(new FormData());
    assert.equal(calls, 1);
    fail(new Error('network'));
    await pending;
    f.render();
    assert.match(
      f.h.find((node) => node.props.role === 'alert').props.children,
      /Your work is still here/,
    );
    assert.equal(f.released(), 0);
  } finally {
    f.close();
  }
});
test('article uploads retain the draft and add registered assets; failures remain retryable', async () => {
  for (const failure of [false, true]) {
    const f = fixture({ uploadError: failure ? { message: 'failed' } : null });
    try {
      f.button('Add paragraph').props.onClick();
      f.render();
      const input = f.h.find((node) => node.props.type === 'file');
      input.props.onChange({
        target: {
          files: [new File(['image'], 'vpn.png', { type: 'image/png' })],
          value: 'vpn.png',
        },
      });
      await tick();
      f.render();
      assert.equal(f.text().length, 3);
      assert.equal(f.uploads.length, 1);
      assert.equal(f.registrations.length, failure ? 0 : 1);
      const status = f.h.find((node) => node.props.role === 'status').props.children;
      assert.match(status, failure ? /Upload failed.*retry/ : /File added/);
      if (!failure)
        assert.ok(f.h.find((node) => node.type === 'a' && node.props.children === 'vpn.png'));
    } finally {
      f.close();
    }
  }
});
test('article publication keeps audience controls and library collection choices', () => {
  const f = fixture({ library: true });
  try {
    const audience = f.h.find((node) => node.props.name === 'audience');
    audience.props.onChange({ target: { value: 'it_only' } });
    f.render();
    assert.equal(f.h.find((node) => node.props.name === 'audience').props.value, 'it_only');
    f.h
      .find((node) => node.props.name === 'helpCollection')
      .props.onChange({ target: { value: 'fixxflow' } });
    f.render();
    assert.ok(f.h.find((node) => node.props.name === 'helpTopic'));
    assert.equal(f.h.all((node) => node.props.type === 'file').length, 0);
    assert.equal(f.guards.at(-1), true);
  } finally {
    f.close();
  }
});
test('related articles stop at eight and allow removing a selected article', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{ id: 'ninth', title: 'Ninth' }], more: false }),
  });
  const h = componentHarness(
    'src/features/knowledge/related-article-picker.tsx',
    'RelatedArticlePicker',
    {
      articleId: 'article',
      initial: Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: String(i) })),
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.render();
    const ninth = h.find((node) => node.type === 'input' && node.props.checked === false);
    assert.equal(ninth.props.disabled, true);
    ninth.props.onChange();
    h.render();
    assert.equal(h.all((node) => node.props.name === 'related').length, 8);
    h.find((node) => node.type === 'input' && node.props.checked === true).props.onChange();
    h.render();
    assert.equal(h.all((node) => node.props.name === 'related').length, 7);
    assert.equal(
      h.find((node) => node.type === 'input' && node.props.checked === false).props.disabled,
      false,
    );
  } finally {
    h.close();
    globalThis.fetch = oldFetch;
  }
});
