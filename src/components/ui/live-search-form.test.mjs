import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const modulePath = 'src/components/ui/live-search-form.tsx';
const { searchHref, LiveSearchForm } = load(modulePath, { 'next/navigation': searchNavigation });

test('live search GET URLs preserve current filters and literal identifiers while resetting pagination', () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ q: '  HP\t12345%_+ ', status: 'repair', ticket: 'ticket-id', view: 'technicians', page: '4', empty: '' })) data.set(key, value);
  const url = new URL(searchHref('/app/assets', data), 'https://example.test');
  assert.equal(url.searchParams.get('q'), 'HP 12345%_+');
  for (const key of ['status', 'ticket', 'view']) assert.equal(url.searchParams.get(key), data.get(key));
  assert.equal(url.searchParams.has('page'), false);
  assert.equal(url.searchParams.has('empty'), false);
  data.set('q', 'x'.repeat(250));
  assert.equal(new URL(searchHref('/app/assets', data), url).searchParams.get('q').length, 200);
});

test('server markup remains a labeled GET form with a submit button and a polite live region', () => {
  const html = renderToStaticMarkup(React.createElement(LiveSearchForm, {
    action: '/app/assets', label: 'Search assets', className: 'queue-filters', resultSummary: '2 matching assets.',
  }, React.createElement('label', null, 'Serial number', React.createElement('input', { name: 'q', type: 'search' })), React.createElement('button', { type: 'submit' }, 'Search')));
  assert.match(html, /action="\/app\/assets" method="get"/);
  assert.match(html, /role="search" aria-label="Search assets"/);
  assert.match(html, /type="submit"/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /disabled|autofocus/i);
});

function harness(t, initial = '/app/assets?status=repair') {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hooks = []; let cursor = 0; let effects = []; let href = initial; let pending = false; let summary = '2 matching assets.';
  const calls = [];
  const router = { replace: (...args) => calls.push(['replace', ...args]), refresh: () => calls.push(['refresh']) };
  const document = new EventTarget(); const window = new EventTarget();
  class Element { closest() { return this.link ?? null; } }
  class Input extends Element {
    name = 'q';
    get value() { return form.values.get(this.name) ?? ''; }
    set value(value) { form.values.set(this.name, value); }
  }
  class Select extends Element {}
  const input = new Input();
  const NativeFormData = globalThis.FormData;
  const form = {
    values: new Map(new URL(initial, 'https://example.test').searchParams),
    elements: [input], contains: link => Boolean(link.inside),
  };
  const replacements = { document, window, Element, HTMLInputElement: Input, HTMLSelectElement: Select, FormData: class extends NativeFormData {
    constructor(source) { super(); for (const [key, value] of source?.values ?? []) this.set(key, value); }
  } };
  for (const [key, value] of Object.entries(replacements)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const changed = (before, after) => !before || before.length !== after.length || before.some((x, i) => x !== after[i]);
  const react = { ...React,
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(value) { const i = cursor++; hooks[i] ??= { value }; return [hooks[i].value, next => { hooks[i].value = next; }]; },
    useCallback(fn, deps) { const i = cursor++; if (changed(hooks[i]?.deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (changed(hooks[i]?.deps, deps)) effects.push(() => { hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
    useTransition: () => [pending, fn => { pending = true; fn(); }],
  };
  const { LiveSearchForm: Form } = load(modulePath, { react, 'next/navigation': {
    useRouter: () => router, usePathname: () => href.split('?')[0], useSearchParams: () => new URLSearchParams(href.split('?')[1]),
  } });
  const render = () => {
    cursor = 0; effects = [];
    const tree = Form({ action: '/app/assets', label: 'Search assets', resultSummary: summary, children: null });
    const [control, status] = React.Children.toArray(tree.props.children);
    control.props.ref.current = form;
    effects.forEach(fn => fn());
    return { control: control.props, status: status.props.children };
  };
  render();
  return {
    calls, form, render, input, Input, Select,
    type(value) { form.values.set('q', value); render().control.onChange({ target: input }); },
    tick(ms = 300) { t.mock.timers.tick(ms); },
    submit() { let prevented = false; render().control.onSubmit({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
    commit(next, message = summary) { href = next; summary = message; pending = false; return render(); },
    link(inside = false) { const event = new Event('click'); Object.defineProperty(event, 'target', { value: Object.assign(new Element(), { link: { inside, pathname: '/app/assets', search: '' } }) }); document.dispatchEvent(event); },
    back() { window.dispatchEvent(new Event('popstate')); },
    dispose() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
}

test('rapid typing sends only the latest search after 300ms, retains filters and does not scroll or push history', t => {
  const h = harness(t);
  h.type('123'); h.tick(299); assert.equal(h.calls.length, 0);
  h.type('12345'); h.tick(299); assert.equal(h.calls.length, 0);
  h.tick(1);
  assert.deepEqual(h.calls, [['replace', '/app/assets?status=repair&q=12345', { scroll: false }]]);
  assert.equal(h.render().status, 'Searching…');
  assert.equal(h.commit(h.calls[0][1], '2 matching assets.').status, '2 matching assets.');
  assert.equal(h.form.values.get('q'), '12345');
});

test('Enter/Search submits immediately and cancels the timer; clearing immediately restores filtered results', t => {
  const h = harness(t);
  h.type('12345'); h.submit(); h.tick();
  assert.equal(h.calls.length, 1);
  h.commit(h.calls[0][1]); h.type('');
  assert.deepEqual(h.calls[1], ['replace', '/app/assets?status=repair', { scroll: false }]);
  h.tick(); assert.equal(h.calls.length, 2);
});

test('composition does not navigate or submit until the composed text is complete', t => {
  const h = harness(t);
  h.render().control.onCompositionStart(); h.type('中'); h.tick(); h.submit();
  assert.equal(h.calls.length, 0);
  let prevented = false;
  h.render().control.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  h.render().control.onCompositionEnd(); h.tick(299); assert.equal(h.calls.length, 0);
  h.tick(1); assert.equal(new URL(h.calls[0][1], 'https://example.test').searchParams.get('q'), '中');
});

test('a slower search response preserves newer typing and its queued request', t => {
  const h = harness(t);
  h.type('12'); h.tick(); const first = h.calls[0][1];
  h.type('12345'); h.commit(first);
  assert.equal(h.form.values.get('q'), '12345');
  h.tick(); assert.match(h.calls[1][1], /q=12345$/);
  h.commit(h.calls[1][1]); assert.equal(h.form.values.get('q'), '12345');
});

test('clear links, pagination and Back/Forward cancel queued work and restore the URL controls', t => {
  const h = harness(t, '/app/assets?status=repair&q=old&page=2');
  h.type('unsubmitted'); h.link(); h.tick(); assert.equal(h.calls.length, 0);
  h.commit('/app/assets'); assert.equal(h.form.values.get('q'), '');
  h.type('another draft'); h.back(); h.commit('/app/assets?q=restored&page=2'); h.tick();
  assert.equal(h.form.values.get('q'), 'restored'); assert.equal(h.calls.length, 0);
  h.type('page draft'); h.commit('/app/assets?q=restored&page=3'); h.tick();
  assert.equal(h.form.values.get('q'), 'restored'); assert.equal(h.calls.length, 0);
});

test('navigation away cleans up timers and listeners; unchanged query can be retried', t => {
  const h = harness(t, '/app/assets?q=12345');
  h.submit(); assert.deepEqual(h.calls, [['refresh']]);
  assert.equal(h.commit('/app/assets?q=12345', 'Search unavailable. Try again.').status, 'Search unavailable. Try again.');
  h.type('pending'); h.dispose(); h.tick(); assert.equal(h.calls.length, 1);
});

test('filter controls restore URL state on Back and clear, including an unsubmitted draft at the same URL', t => {
  const h = harness(t, '/app/assets');
  const status = Object.assign(new h.Select(), { name: 'status', value: 'repair', options: [{ value: '' }, { value: 'repair' }] });
  const overdue = Object.assign(new h.Input(), { name: 'overdue', type: 'checkbox', value: '1', checked: true });
  h.form.elements.push(status, overdue);
  h.type('draft'); h.link(true); h.tick();
  assert.equal(h.calls.length, 0); assert.equal(h.form.values.get('q'), '');
  assert.equal(status.value, ''); assert.equal(overdue.checked, false);
  h.commit('/app/assets?q=old&status=repair&overdue=1');
  assert.equal(status.value, 'repair'); assert.equal(overdue.checked, true);
});

test('whitespace-only changes to the same query do not refetch, but manual retry still works', t => {
  const h = harness(t, '/app/assets?q=12345');
  h.type('12345 '); h.tick(); assert.equal(h.calls.length, 0);
  h.submit(); assert.deepEqual(h.calls, [['refresh']]);
});
