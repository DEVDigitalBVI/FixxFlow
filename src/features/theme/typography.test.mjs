import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import fontkit from '@pdf-lib/fontkit';

import { productStyles } from '../../../tests/helpers/styles.mjs';

const directory = 'public/brand/fixxflow/fonts';
test('self-hosted Inter contains real variable weights, readable Latin UI glyphs and its license', () => {
  for (const file of ['InterVariable.woff2', 'InterVariable-Italic.woff2']) {
    const font = fontkit.create(fs.readFileSync(`${directory}/${file}`));
    assert.ok(font.familyName.startsWith('Inter'), file);
    assert.equal(font.variationAxes.wght.min, 100, file);
    assert.equal(font.variationAxes.wght.max, 900, file);
    for (const character of 'Ticket #1842 Résumé · € 09') {
      assert.ok(font.hasGlyphForCodePoint(character.codePointAt(0)), `${file}: ${character}`);
    }
  }
  assert.match(fs.readFileSync(`${directory}/LICENSE.txt`, 'utf8'), /SIL Open Font License/i);
});

test('headings and body share Inter, headings are semibold and fonts load locally', () => {
  const css = productStyles();
  assert.match(css, /--font-body: var\(--font-inter\)/);
  assert.match(css, /--font-heading: var\(--font-inter\)/);
  assert.match(css, /body\s*\{[^}]*font-family: var\(--font-body\)/);
  assert.match(css, /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{\s*font-weight: 600;/);
  // One weight scale: regular, medium and semibold.
  for (const [, weight] of css.matchAll(/font-weight:\s*(\d+);/g))
    assert.ok(['400', '500', '600'].includes(weight), `unexpected font-weight ${weight}`);
  const layout = fs.readFileSync('src/app/layout.tsx', 'utf8');
  assert.match(layout, /next\/font\/local/);
  assert.match(layout, /InterVariable\.woff2/);
  assert.doesNotMatch(layout, /next\/font\/google|fonts\.googleapis/);
});
