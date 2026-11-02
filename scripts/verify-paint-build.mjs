import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Inspect the actual route assets: source imports alone cannot detect CSS chunk merging.
async function routeCss(route) {
  const context = {};
  vm.runInNewContext(
    await readFile(`.next/server/app/${route}/page_client-reference-manifest.js`, 'utf8'),
    context,
  );
  const manifest = Object.values(context.__RSC_MANIFEST)[0];
  const paths = new Set(
    Object.values(manifest.entryCSSFiles)
      .flat()
      .map((file) => file.path),
  );
  const sheets = await Promise.all([...paths].map((path) => readFile(`.next/${path}`, 'utf8')));
  return sheets.join('\n');
}

for (const route of ['(auth)/login', '(auth)/signup', '(auth)/forgot-password']) {
  const css = await routeCss(route);
  assert.match(css, /\.auth-shell\b/, `${route} retains authentication layout styles`);
  for (const selector of ['chat-connection', 'ticket-link', 'report-metrics']) {
    assert.ok(!css.includes(`.${selector}`), `${route} must not load ${selector} CSS`);
  }
  console.log(`${route}: ${Buffer.byteLength(css)} bytes of CSS; operational styles excluded.`);
}
for (const route of ['app/reports', 'platform']) {
  const css = await routeCss(route);
  for (const selector of ['chat-connection', 'ticket-link', 'report-metrics']) {
    assert.ok(css.includes(`.${selector}`), `${route} retains ${selector} CSS`);
  }
}
console.log('Production route CSS separation verified.');
