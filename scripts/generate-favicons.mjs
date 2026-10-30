/** Export browser icons from the existing transparent mark; never redraw the logo or add a tile. */
import { copyFile, readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

const root = 'public/brand/fixxflow';
const palette = [
  [239, 35, 60],
  [217, 4, 41],
  [43, 45, 66],
  [237, 242, 244],
  [141, 153, 174],
];
const source = await sharp(`${root}/icon/fixxflow-icon-primary.png`)
  .trim({ threshold: 1 })
  .png()
  .toBuffer();
for (const [name, size] of [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['android-chrome-192x192.png', 192],
  ['android-chrome-512x512.png', 512],
]) {
  const padding = Math.max(1, Math.round(size / 16));
  const { data, info } = await sharp(source)
    .resize(size - padding * 2, size - padding * 2, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Retain antialias alpha while keeping visible RGB in the exact approved palette.
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const nearest = palette.reduce(
      (best, rgb) => {
        const distance = rgb.reduce((sum, v, c) => sum + (data[i + c] - v) ** 2, 0);
        return distance < best.distance ? { rgb, distance } : best;
      },
      { rgb: palette[0], distance: Infinity },
    );
    data.set(nearest.rgb, i);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(`${root}/favicon/${name}`);
}
const sizes = [16, 32],
  images = await Promise.all(sizes.map((n) => readFile(`${root}/favicon/favicon-${n}x${n}.png`)));
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
console.log(
  'Exported transparent browser/app favicons and matching root ICO from the unchanged logo master.',
);
