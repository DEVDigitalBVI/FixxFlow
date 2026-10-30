import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import fontkit from '@pdf-lib/fontkit';

import { productStyles } from '../../../tests/helpers/styles.mjs';

const directory = 'public/brand/fixxflow/fonts';
test('self-hosted typefaces contain real variable weights and readable Latin UI glyphs', () => {
  for (const [file, family, min, max] of [
    ['Outfit-Variable.ttf', 'Outfit', 100, 900],
    ['RethinkSans-Variable.ttf', 'Rethink Sans', 400, 800],
    ['RethinkSans-Italic-Variable.ttf', 'Rethink Sans', 400, 800],
  ]) {
    const font = fontkit.create(fs.readFileSync(`${directory}/${file}`));
    assert.ok(font.familyName.startsWith(family), file);
    assert.equal(font.variationAxes.wght.min, min, file);
    assert.equal(font.variationAxes.wght.max, max, file);
    for (const character of 'Ticket #1842 Résumé · € 09') {
      assert.ok(font.hasGlyphForCodePoint(character.codePointAt(0)), `${file}: ${character}`);
    }
  }
  for (const family of ['Outfit', 'RethinkSans']) {
    assert.match(
      fs.readFileSync(`${directory}/${family}-OFL.txt`, 'utf8'),
      /SIL OPEN FONT LICENSE/,
    );
  }
});

test('body and bold typography stay separate across shared and feature styles', () => {
  const css = productStyles();
  assert.match(css, /body\s*\{[^}]*font-family: var\(--font-body\)/);
  assert.match(
    css,
    /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6,\s*strong,\s*b\s*\{\s*font-family: var\(--font-heading\)/,
  );
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*font-weight:\s*(\d+);[^{}]*)\}/g)) {
    const [, selector, declarations, weight] = match;
    if (/company-provider|@font-face/.test(selector)) continue;
    assert.ok(
      declarations.includes(
        `font-family: var(--font-${Number(weight) >= 600 ? 'heading' : 'body'})`,
      ),
      selector.trim(),
    );
  }
  assert.doesNotMatch(css, /--font-inter/);
  const layout = fs.readFileSync('src/app/layout.tsx', 'utf8');
  assert.match(layout, /next\/font\/local/);
  assert.doesNotMatch(layout, /next\/font\/google|fonts\.googleapis/);
});
