/** Palette-only migration: preserve every pixel's location and alpha, including wordmark geometry.
 * No resampling, redrawing, cropping or regenerated artwork. Safe to rerun on the migrated package.
 */
import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const root = 'public/brand/fixxflow';
const slots = new Map([
  ['255,215,0', [239, 35, 60]],
  ['33,37,41', [43, 45, 66]],
  ['255,255,255', [237, 242, 244]],
  ['173,181,189', [141, 153, 174]],
]);
const approved = new Set(['239,35,60', '217,4,41', '43,45,66', '237,242,244', '141,153,174']);
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map(async (e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
let updated = 0;
for (const file of (await files(root)).filter((f) => f.endsWith('.png'))) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = Buffer.from(data.filter((_, i) => i % 4 === 3));
  let changed = false;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    const rgb = slots.get(key);
    if (rgb) {
      data.set(rgb, i);
      changed = true;
    } else if (!approved.has(key)) throw Error(`Unexpected source color in ${file}: ${key}`);
  }
  if (!changed) continue;
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  const check = await sharp(png).ensureAlpha().raw().toBuffer();
  if (!Buffer.from(check.filter((_, i) => i % 4 === 3)).equals(alpha))
    throw Error(`Alpha changed: ${file}`);
  await writeFile(file, png);
  updated++;
}
// ICO contains PNG entries; rebuild its directory without changing the 16/32px artwork.
const sizes = [16, 32];
const images = await Promise.all(
  sizes.map((n) => readFile(`${root}/favicon/favicon-${n}x${n}.png`)),
);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const pos = 6 + i * 16;
  header[pos] = sizes[i];
  header[pos + 1] = sizes[i];
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(image.length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += image.length;
});
await writeFile(`${root}/favicon/favicon.ico`, Buffer.concat([header, ...images]));
await copyFile(`${root}/favicon/favicon.ico`, 'src/app/favicon.ico');
const notes = JSON.parse(await readFile(`${root}/source/source-notes.json`, 'utf8'));
notes.source =
  'Product-owner-authorized navy, slate, frost, red and crimson palette migration, October 30 2026';
notes.palette = {
  navy: '#2B2D42',
  slate: '#8D99AE',
  frost: '#EDF2F4',
  red: '#EF233C',
  crimson: '#D90429',
};
notes.method =
  'Exact palette-slot substitution in the existing raster artwork. Original dimensions, pixel positions, alpha masks, F, wrench, wordmark and spacing preserved. Generated logo variation was not adopted, in accordance with the product owner’s consistency instruction.';
notes.prompts = {
  paletteReference:
    'Built-in imagegen reference: preserve exact F and wrench; replace yellow with red, charcoal with navy, white with frost and gray with slate. Reference only; existing geometry is authoritative.',
};
notes.derivatives =
  'All logo variants, source masters, app icons, favicon PNGs and ICO share the red/navy palette. Monochrome variants retain their single-color role.';
notes.artworkFingerprints = {};
for (const name of ['primary', 'dark-mode', 'dark-mode-transparent', 'horizontal-full'])
  notes.artworkFingerprints[name] = createHash('sha256')
    .update(await readFile(`${root}/logo/fixxflow-logo-${name}.png`))
    .digest('hex');
await writeFile(`${root}/source/source-notes.json`, JSON.stringify(notes, null, 2) + '\n');
console.log(
  `Recolored ${updated} brand PNGs; preserved every original dimension and alpha mask; rebuilt favicon copies.`,
);
