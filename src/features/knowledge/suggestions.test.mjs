import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(fetcher, title = 'printer') {
  const previous = { fetch: globalThis.fetch, FormData: globalThis.FormData };
  const events = new Map(),
    slots = [];
  let cursor = 0,
    effects = [];
  const form = {
    values: { title, description: 'Private diagnostic details' },
    querySelector: () => null,
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
  };
  globalThis.FormData = class {
    get(name) {
      return form.values[name];
    }
  };
  globalThis.fetch = fetcher;
  const hooks = {
    ...React,
    useId: () => `suggestions-${cursor++}`,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??=
        initial === null ? { current: { closest: () => form } } : { current: initial });
    },
    useEffect(fn, deps) {
      const index = cursor++,
        old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i])))
        effects.push(() => {
          old?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
    },
  };
  const { TicketSuggestions } = load('src/features/knowledge/ticket-suggestions.tsx', {
    react: hooks,
  });
  return {
    form,
    events,
    render() {
      cursor = 0;
      effects = [];
      const html = renderToStaticMarkup(React.createElement(TicketSuggestions));
      effects.forEach((fn) => fn());
      return html;
    },
    close() {
      for (const slot of slots) slot?.cleanup?.();
      Object.assign(globalThis, previous);
    },
  };
}
test('subject suggestions distinguish no related guide from a loading error without blocking request fields', async () => {
  for (const failure of [false, true]) {
    const calls = [];
    const h = fixture(async (url, options) => {
      calls.push({ url, options });
      return failure ? new Response('', { status: 503 }) : Response.json({ rows: [] });
    });
    try {
      assert.match(h.render(), /hidden=""/, 'nothing is shown before the subject is read');
      await wait(270);
      assert.match(h.render(), /Looking for related guides/);
      await wait();
      const html = h.render();
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /q=printer/);
      assert.doesNotMatch(calls[0].url, /Private|diagnostic|description/);
      assert.equal(calls[0].options.cache, 'no-store');
      if (failure) {
        assert.match(html, /Guides couldn’t load\. You can still submit your request/);
        assert.match(html, />Retry<\/button>/);
        assert.doesNotMatch(html, /No related guides found/);
      } else {
        assert.match(html, /No related guides found\. Continue with your request/);
        assert.doesNotMatch(html, /couldn’t load|Retry/);
      }
      assert.doesNotMatch(html, /<input|<textarea|<button[^>]*type="submit"/);
    } finally {
      h.close();
    }
  }
});
test('obsolete suggestion requests are cancelled and cannot replace the current subject results', async () => {
  let resolveOld;
  const calls = [];
  const h = fixture((url, options) => {
    calls.push({ url, options });
    return url.includes('q=printer')
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(
          Response.json({
            rows: [
              {
                id: 'vpn',
                title: 'VPN guide',
                summary: 'Connect safely.',
                category: 'Network',
                audience: 'employees',
                organization_id: null,
              },
            ],
          }),
        );
  });
  try {
    h.render();
    await wait(270);
    h.render();
    h.form.values.title = 'VPN';
    h.events.get('input')();
    await wait(270);
    h.render();
    resolveOld(
      Response.json({
        rows: [
          {
            id: 'printer',
            title: 'Old printer guide',
            summary: 'Old response',
            category: 'Hardware',
          },
        ],
      }),
    );
    await wait();
    const html = h.render();
    assert.equal(calls[0].options.signal.aborted, true);
    assert.match(html, /VPN guide/);
    assert.doesNotMatch(html, /Old printer guide/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /opens in a new tab/);
  } finally {
    h.close();
  }
});
