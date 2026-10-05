import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('src/app/app/support/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'module', 'exports', code)(name => name === 'next/link'
  ? { default: props => React.createElement('a', props) }
  : require(name), compiled, compiled.exports);

test('support offers an email draft and fallback without claiming a message was sent', () => {
  const html = renderToStaticMarkup(React.createElement(compiled.exports.default));
  assert.match(html, /href="mailto:support@fixxflow.app\?subject=FixxFlow%20support"/);
  assert.match(html, /Opens your email app/);
  assert.match(html, />support@fixxflow.app<\/a>/);
  assert.match(html, /sent when you choose Send/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /aria-labelledby="email-support-heading"/);
  assert.match(html, /id="email-support-heading"/);
  assert.match(html, /href="\/app\/tickets\/new"/);
  assert.match(html, /href="\/app\/help"/);
});
