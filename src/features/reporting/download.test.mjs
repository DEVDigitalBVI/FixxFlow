import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

const { fetchReportDownload } = load('src/features/reporting/download.ts');
test('download controls have visible format labels, native fallback and polite status announcements', () => {
  const { ReportDownload } = load('src/features/reporting/report-download.tsx');
  const html = renderToStaticMarkup(React.createElement(ReportDownload));
  assert.match(html, /action="\/app\/reports\/export" method="get"/);
  assert.match(html, /<label for="report-format">File format<\/label>/);
  assert.match(html, /id="report-format" name="format"/);
  assert.match(html, /value="xlsx" selected=""/);
  for (const choice of ['Excel (.xlsx)', 'CSV (.csv)', 'PDF (.pdf)']) assert.ok(html.includes(choice));
  assert.match(html, /type="submit">Download report/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /disabled/);
});

test('client sends authenticated uncached requests and reads the download filename and bytes', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/app/reports/export?format=csv');
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.signal, controller.signal);
    return new Response('sample', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="fixxflow-report-2026-09-27.csv"' } });
  });
  const result = await fetchReportDownload('csv', controller.signal);
  assert.equal(result.filename, 'fixxflow-report-2026-09-27.csv'); assert.equal(await result.blob.text(), 'sample');
});

test('client never saves an expired-session HTML page or a failed or wrong-format response', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [response, message] of [
    [new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }), /session may have expired/],
    [Response.json({ error: 'Reporting unavailable. Retry.' }, { status: 503 }), /Reporting unavailable/],
    [new Response('gateway failure', { status: 502 }), /could not be downloaded/],
    [new Response('wrong type', { headers: { 'Content-Type': 'text/plain' } }), /unexpected file/],
  ]) {
    fetch.mock.mockImplementation(async () => response);
    await assert.rejects(fetchReportDownload('pdf', new AbortController().signal), message);
  }
});

function harness(t, download) {
  const hooks = []; let cursor = 0; let effects = []; let focused = false;
  const react = { ...React,
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useState(value) { const index = cursor++; hooks[index] ??= { value }; return [hooks[index].value, next => { hooks[index].value = next; }]; },
    useEffect(fn, deps) { const index = cursor++; if (!hooks[index] || deps.some((d, i) => d !== hooks[index].deps[i])) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const NativeFormData = globalThis.FormData;
  t.mock.method(globalThis, 'FormData', class extends NativeFormData { constructor(form) { super(); this.set('format', form.format); } });
  const { ReportDownload } = load('src/features/reporting/report-download.tsx', { react, './download': { fetchReportDownload: download } });
  function render() {
    cursor = 0; effects = [];
    const tree = ReportDownload(); const children = React.Children.toArray(tree.props.children);
    const error = children.find(child => child.props?.role === 'alert');
    if (error) error.props.ref.current = { focus() { focused = true; } };
    effects.forEach(effect => effect());
    return { tree, form: children[0], error, status: children.find(child => child.props?.role === 'status') };
  }
  return { render, submit: format => render().form.props.onSubmit({ currentTarget: { format }, preventDefault() {} }), focused: () => focused, dispose: () => hooks.forEach(hook => hook.cleanup?.()) };
}

test('preparation blocks duplicate requests, failures focus feedback and allow retry with the same format', async t => {
  let reject; const calls = [];
  const h = harness(t, (format, signal) => { calls.push({ format, signal }); return new Promise((_, failure) => { reject = failure; }); });
  const first = h.submit('pdf');
  assert.equal(h.render().form.props['aria-busy'], true);
  assert.match(renderToStaticMarkup(h.render().form), /disabled=""/);
  assert.equal(h.render().status.props.children, 'Preparing report…');
  await h.submit('pdf'); assert.equal(calls.length, 1);
  reject(new Error('Temporary failure')); await first;
  assert.equal(h.render().form.props['aria-busy'], false); assert.equal(h.focused(), true);
  assert.match(renderToStaticMarkup(h.render().error), /Temporary failure.*Reload Reports/);
  const retry = h.submit('pdf'); assert.equal(calls.length, 2); assert.equal(calls[1].format, 'pdf');
  h.dispose(); assert.equal(calls[1].signal.aborted, true);
  reject(new Error('Aborted')); await retry;
});
