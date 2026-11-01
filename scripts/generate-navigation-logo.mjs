/** Derive a dark horizontal lockup from approved artwork without redrawing any lettering. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

const root = 'public/brand/fixxflow';
const source = `${root}/logo/fixxflow-logo-horizontal-full.png`;
const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const before = Buffer.from(data);
// The master has clear space between the icon (left) and wordmark (right).
// Only navy lettering/tagline pixels in the wordmark area become frost; the mark and red Flow stay exact.
const wordmarkStart = Math.floor(info.width * 0.28);
for (let y = 0; y < info.height; y++)
  for (let x = wordmarkStart; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] && data[i] === 43 && data[i + 1] === 45 && data[i + 2] === 66)
      data.set([237, 242, 244], i);
  }
for (let i = 3; i < data.length; i += 4)
  if (data[i] !== before[i]) throw Error('Logo alpha changed');
const filename = 'logo/fixxflow-logo-horizontal-dark.png';
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(`${root}/${filename}`);
const notes = JSON.parse(await readFile(`${root}/source/source-notes.json`, 'utf8'));
notes.alphaFingerprints[filename] = createHash('sha256')
  .update(Buffer.from(data.filter((_, i) => i % 4 === 3)))
  .digest('hex');
notes.navigationArtwork =
  'Navigation uses the approved complete horizontal lockup. Dark variant changes only navy wordmark/tagline pixels to frost; the original icon, red lettering, dimensions, layout and alpha mask remain unchanged.';
await writeFile(`${root}/source/source-notes.json`, JSON.stringify(notes, null, 2) + '\n');
console.log(
  'Generated dark navigation artwork; original letterforms, mark, spacing and transparency preserved.',
);
