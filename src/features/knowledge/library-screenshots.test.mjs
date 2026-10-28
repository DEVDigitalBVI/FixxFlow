import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { LibraryArticleContent } = load('src/features/knowledge/library-article-content.tsx');
const collection = JSON.parse(fs.readFileSync('content/knowledge/general-it.json', 'utf8'));
const { microsoftScreenshots: screenshots } = load(
  'src/features/knowledge/microsoft-screenshots.ts',
);
const escape = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const render = (content) =>
  renderToStaticMarkup(React.createElement(LibraryArticleContent, { content }));

test('every curated screenshot matches a current step, has a local image and retains provenance', () => {
  for (const shot of screenshots) {
    const article = collection.articles.find(
      (article) =>
        article.content.some((block) => block.type === 'link' && block.url === shot.source) &&
        article.content.some(
          (block) => block.type === 'paragraph' && block.text === shot.afterText,
        ),
    );
    assert.ok(article, shot.src);
    assert.match(shot.src, /^\/knowledge\/microsoft\/[a-z0-9.-]+$/);
    assert.match(shot.original, /^https:\/\/support\.microsoft\.com\//);
    const bytes = fs.readFileSync(`public${shot.src}`);
    assert.ok(
      bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) ||
        bytes.subarray(0, 2).equals(Buffer.from([255, 216])),
    );
    assert.ok(shot.width >= 100 && shot.height > 0);
    const html = render(article.content);
    const stepIndex = html.indexOf(escape(shot.afterText));
    assert.ok(stepIndex >= 0 && stepIndex < html.indexOf(`src="${shot.src}"`));
    assert.ok(html.includes(`alt="${escape(shot.alt)}"`));
    assert.ok(html.includes(`width="${shot.width}" height="${shot.height}"`));
    assert.match(html, /loading="lazy"/);
    assert.match(html, /<figcaption>/);
    assert.match(html, /Open full-size screenshot/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /opens in a new tab/);
  }
});

test('edited steps and articles missing the reference never receive an unrelated screenshot', () => {
  const shot = screenshots[0];
  assert.doesNotMatch(render([{ type: 'paragraph', text: shot.afterText }]), /<figure/);
  assert.doesNotMatch(
    render([
      { type: 'paragraph', text: 'Updated instructions' },
      { type: 'link', text: 'Microsoft', url: shot.source },
    ]),
    /<figure/,
  );
  assert.match(render(null), /role="alert"/);
});
