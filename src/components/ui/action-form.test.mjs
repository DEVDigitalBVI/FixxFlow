import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

function fixture(action, extra = {}) {
  let dirty = false,
    released = 0;
  const navigations = [];
  const h = componentHarness(
    'src/components/ui/action-form.tsx',
    'ActionForm',
    { action, children: 'Fields', ...extra },
    {
      'next/navigation': { useRouter: () => ({ push: (url) => navigations.push(url) }) },
      './unsaved-changes': {
        useUnsavedChanges: (value) => {
          dirty = value;
          return () => {
            released++;
          };
        },
      },
    },
  );
  const Original = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) {
      return form.data;
    }
  };
  const form = {
    data: new Original(),
    resets: 0,
    reset() {
      this.resets++;
    },
  };
  form.data.set('status', 'open');
  h.find((n) => n.type === 'form').props.onFocusCapture({ currentTarget: form });
  return {
    h,
    form,
    navigations,
    dirty: () => dirty,
    released: () => released,
    change(name, value) {
      form.data.set(name, value);
      h.find((n) => n.type === 'form').props.onChange({ currentTarget: form });
      h.render();
    },
    submit() {
      return h
        .find((n) => n.type === 'form')
        .props.onSubmit({ preventDefault() {}, currentTarget: form });
    },
    close() {
      h.close();
      globalThis.FormData = Original;
    },
  };
}

test('classification edits warn, restoring original values clears the warning, and hidden revisions are ignored', () => {
  const f = fixture(async () => ({}));
  try {
    f.change('status', 'in_progress');
    assert.equal(f.dirty(), true);
    f.change('status', 'open');
    assert.equal(f.dirty(), false);
    f.change('revision', '2');
    assert.equal(f.dirty(), false);
    f.change('assignedTechnicianId', 'worker');
    assert.equal(f.dirty(), true);
  } finally {
    f.close();
  }
});

test('failed saves preserve entries, retain protection, focus feedback and permit retry', async () => {
  let fail = true;
  const f = fixture(
    async () => (fail ? { error: 'Please correct the name.' } : { success: 'Saved.' }),
    { resetOnSuccess: true },
  );
  try {
    f.change('name', 'Office');
    f.submit();
    await new Promise((resolve) => setImmediate(resolve));
    f.h.render();
    assert.equal(f.form.data.get('name'), 'Office');
    assert.equal(f.form.resets, 0);
    assert.equal(f.dirty(), true);
    assert.equal(f.h.focuses.at(-1), 'feedback');
    fail = false;
    f.submit();
    await new Promise((resolve) => setImmediate(resolve));
    f.h.render();
    assert.equal(f.form.resets, 1);
    assert.equal(f.dirty(), false);
    assert.equal(f.released(), 1);
  } finally {
    f.close();
  }
});

test('a pending save rejects duplicate submissions and a successful redirect releases protection', async () => {
  let complete,
    calls = 0;
  const f = fixture(() => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  try {
    f.change('name', 'Office');
    f.submit();
    f.submit();
    assert.equal(calls, 1);
    assert.equal(f.dirty(), true);
    complete({ redirectTo: '/app/tickets/created' });
    await new Promise((resolve) => setImmediate(resolve));
    f.h.render();
    assert.deepEqual(f.navigations, ['/app/tickets/created']);
    assert.equal(f.dirty(), false);
  } finally {
    f.close();
  }
});

test('beforeRedirect runs after a successful save and may replace the destination', async () => {
  const seen = [];
  const f = fixture(async () => ({ redirectTo: '/app/tickets/created?success=Sent' }), {
    beforeRedirect: async (url) => {
      seen.push(url);
      return `${url}%20with%20note`;
    },
  });
  try {
    f.submit();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, ['/app/tickets/created?success=Sent']);
    assert.deepEqual(f.navigations, ['/app/tickets/created?success=Sent%20with%20note']);
  } finally {
    f.close();
  }
  const failing = fixture(async () => ({ redirectTo: '/app/tickets/created' }), {
    beforeRedirect: async () => {
      throw new Error('upload crashed');
    },
  });
  try {
    failing.submit();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(failing.navigations, ['/app/tickets/created'], 'a saved ticket still opens');
  } finally {
    failing.close();
  }
});

test('native validation reveals all enclosing disclosures without losing values', () => {
  const f = fixture(async () => ({}));
  try {
    const outer = { tagName: 'DETAILS', open: false, parentElement: null };
    const inner = { tagName: 'DETAILS', open: false, parentElement: outer };
    const field = { value: 'Unsaved entry', parentElement: inner };
    f.h.find((n) => n.type === 'form').props.onInvalidCapture({ target: field });
    assert.equal(inner.open, true);
    assert.equal(outer.open, true);
    assert.equal(field.value, 'Unsaved entry');
  } finally {
    f.close();
  }
});

test('named server errors provide a focus action that reveals the invalid field', async () => {
  const f = fixture(async () => ({
    error: 'Review the location.',
    fieldErrors: { name: 'Choose another name.' },
  }));
  try {
    f.submit();
    await new Promise((resolve) => setImmediate(resolve));
    f.h.render();
    const disclosure = { tagName: 'DETAILS', open: false, parentElement: null };
    let focused = false;
    f.h.find((n) => n.type === 'form').props.ref.current.elements = {
      namedItem: (name) =>
        name === 'name'
          ? {
              parentElement: disclosure,
              focus() {
                focused = true;
              },
            }
          : null,
    };
    f.h
      .find((n) => n.type === 'button' && n.props.children === 'Choose another name.')
      .props.onClick();
    assert.equal(disclosure.open, true);
    assert.equal(focused, true);
  } finally {
    f.close();
  }
});

test('upload stages remain announced and duplicate submissions stay blocked until navigation', async () => {
  let finishUpload,
    calls = 0;
  const f = fixture(
    async () => {
      calls++;
      return { redirectTo: '/app/tickets/created' };
    },
    {
      pendingMessage: 'Request created. Uploading file 1 of 2…',
      beforeRedirect: () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    },
  );
  try {
    const submission = f.submit();
    await new Promise((resolve) => setImmediate(resolve));
    f.h.render();
    assert.equal(
      f.h.find((n) => n.type === 'span' && n.props.role === 'status').props.children,
      'Request created. Uploading file 1 of 2…',
    );
    assert.equal(f.h.find((n) => n.type === 'fieldset').props.disabled, true);
    await f.submit();
    assert.equal(calls, 1);
    assert.deepEqual(f.navigations, []);
    finishUpload();
    await submission;
    assert.deepEqual(f.navigations, ['/app/tickets/created']);
  } finally {
    f.close();
  }
});
