import test from 'node:test';
import assert from 'node:assert/strict';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

function fixture(action, extra = {}) {
  let dirty = false, released = 0;
  const navigations = [];
  const h = componentHarness('src/components/ui/action-form.tsx', 'ActionForm', { action, children: 'Fields', ...extra }, {
    'next/navigation': { useRouter: () => ({ push: url => navigations.push(url) }) },
    './unsaved-changes': { useUnsavedChanges: value => { dirty = value; return () => { released++; }; } },
  });
  const Original = globalThis.FormData;
  globalThis.FormData = class { constructor(form) { return form.data; } };
  const form = { data: new Original(), resets: 0, reset() { this.resets++; } };
  form.data.set('status', 'open');
  h.find(n => n.type === 'form').props.onFocusCapture({ currentTarget: form });
  return { h, form, navigations, dirty: () => dirty, released: () => released, change(name, value) { form.data.set(name, value); h.find(n => n.type === 'form').props.onChange({ currentTarget: form }); h.render(); }, submit() { return h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: form }); }, close() { h.close(); globalThis.FormData = Original; } };
}

test('classification edits warn, restoring original values clears the warning, and hidden revisions are ignored', () => {
  const f = fixture(async () => ({}));
  try {
    f.change('status', 'in_progress'); assert.equal(f.dirty(), true);
    f.change('status', 'open'); assert.equal(f.dirty(), false);
    f.change('revision', '2'); assert.equal(f.dirty(), false);
    f.change('assignedTechnicianId', 'worker'); assert.equal(f.dirty(), true);
  } finally { f.close(); }
});

test('failed saves preserve entries, retain protection, focus feedback and permit retry', async () => {
  let fail = true;
  const f = fixture(async () => fail ? { error: 'Please correct the name.' } : { success: 'Saved.' }, { resetOnSuccess: true });
  try {
    f.change('name', 'Office'); f.submit(); await new Promise(resolve => setImmediate(resolve)); f.h.render();
    assert.equal(f.form.data.get('name'), 'Office'); assert.equal(f.form.resets, 0); assert.equal(f.dirty(), true);
    assert.equal(f.h.focuses.at(-1), 'feedback');
    fail = false; f.submit(); await new Promise(resolve => setImmediate(resolve)); f.h.render();
    assert.equal(f.form.resets, 1); assert.equal(f.dirty(), false); assert.equal(f.released(), 1);
  } finally { f.close(); }
});

test('a pending save rejects duplicate submissions and a successful redirect releases protection', async () => {
  let complete, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  try {
    f.change('name', 'Office'); f.submit(); f.submit(); assert.equal(calls, 1); assert.equal(f.dirty(), true);
    complete({ redirectTo: '/app/tickets/created' }); await new Promise(resolve => setImmediate(resolve)); f.h.render();
    assert.deepEqual(f.navigations, ['/app/tickets/created']); assert.equal(f.dirty(), false);
  } finally { f.close(); }
});
