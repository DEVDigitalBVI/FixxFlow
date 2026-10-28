/**
 * Screenshot comparison for CSS refactors, using the synthetic interface preview
 * (no credentials, no network data).
 *
 *   PLAYWRIGHT_MODULE=/path/to/playwright node scripts/visual-compare.mjs capture <dir>
 *   node scripts/visual-compare.mjs compare <before-dir> <after-dir> [diff-dir]
 *
 * Capture before a change, capture again after it, then compare. Compare exits 1
 * when any screen differs and writes a highlighted diff image for each one.
 * Playwright is not a project dependency; point PLAYWRIGHT_MODULE at an install.
 * Without it, capture uses scripts/visual-capture.swift (system WebKit, macOS).
 * Always compare captures made with the same engine.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

const screens = [
  ['staff-queue', '/'],
  ['staff-queue-drawer', '/?ticket=ticket-0'],
  ['staff-tickets', '/app/tickets'],
  ['staff-new-ticket', '/app/tickets/new'],
  ['staff-help', '/app/help'],
  ['staff-assets', '/app/assets'],
  ['staff-profile', '/app/profile'],
  ['staff-notifications', '/app/notifications'],
  ['staff-administration', '/?surface=administration'],
  ['staff-chat', '/?surface=chat-fixes'],
  ['staff-asset-editor', '/?surface=asset-editor'],
  ['staff-article-editor', '/?surface=article-editor'],
  ['staff-report-builder', '/?surface=report-builder'],
  ['technician-queue', '/?role=technician'],
  ['platform-shell', '/?role=platform'],
  ['employee-home', '/?role=employee'],
  ['employee-new-request', '/app/tickets/new?role=employee'],
  ['employee-requests', '/?surface=requests-search&role=employee'],
  ['employee-chat', '/?surface=chat-fixes&role=employee'],
  ['employee-chat-intake', '/?surface=chat-intake&role=employee'],
  ['employee-help', '/app/help?role=employee'],
  ['sign-in', '/?surface=auth'],
];
const viewports = [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
];
const themes = ['light', 'dark'];
// Freeze motion and the caret so only style changes produce differences.
const stillness =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

async function loadPlaywright() {
  try {
    return await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  } catch {
    return null;
  }
}

/** System WebKit capture via a small compiled Swift tool (macOS only). */
function captureWithWebKit(port, dir) {
  const binary = path.join(os.tmpdir(), 'fixxflow-visual-capture');
  const source = 'scripts/visual-capture.swift';
  if (!fs.existsSync(binary) || fs.statSync(binary).mtimeMs < fs.statSync(source).mtimeMs)
    execFileSync('swiftc', ['-O', source, '-o', binary], { stdio: 'inherit' });
  const jobs = [];
  for (const [name, route] of screens)
    for (const [size, viewport] of viewports)
      for (const theme of themes) {
        const url = new URL(route, `http://127.0.0.1:${port}`);
        url.searchParams.set('theme', theme);
        jobs.push(
          [
            url,
            viewport.width,
            viewport.height,
            theme,
            path.resolve(dir, `${name}--${size}--${theme}.png`),
          ].join('\t'),
        );
      }
  execFileSync(binary, { input: jobs.join('\n') + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
}

async function capture(dir) {
  const playwright = await loadPlaywright();
  fs.mkdirSync(dir, { recursive: true });
  const port = 4300 + Math.floor(Math.random() * 500);
  const server = spawn(
    process.execPath,
    ['tests/helpers/interface-audit-preview.mjs', String(port)],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => String(chunk).includes('Interface preview') && resolve());
    server.on('exit', (code) => reject(new Error(`Preview server exited (${code})`)));
  });
  if (!playwright) {
    try {
      captureWithWebKit(port, dir);
    } finally {
      server.kill();
    }
    console.log(`Captured ${fs.readdirSync(dir).length} screenshots with system WebKit in ${dir}`);
    return;
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    for (const [name, route] of screens)
      for (const [size, viewport] of viewports)
        for (const theme of themes) {
          const context = await browser.newContext({
            viewport,
            colorScheme: theme,
            reducedMotion: 'reduce',
            deviceScaleFactor: 1,
          });
          const page = await context.newPage();
          await page.clock.setFixedTime(new Date('2026-10-20T14:00:00Z'));
          const url = new URL(route, `http://127.0.0.1:${port}`);
          url.searchParams.set('theme', theme);
          await page.goto(url.toString(), { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: stillness });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(150);
          await page.screenshot({
            path: path.join(dir, `${name}--${size}--${theme}.png`),
            fullPage: true,
          });
          await context.close();
        }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(
    `Captured ${screens.length * viewports.length * themes.length} screenshots in ${dir}`,
  );
}

async function raw(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function compare(before, after, diffDir) {
  const names = fs.readdirSync(before).filter((name) => name.endsWith('.png'));
  const changed = [];
  if (diffDir) fs.mkdirSync(diffDir, { recursive: true });
  for (const name of names) {
    const target = path.join(after, name);
    if (!fs.existsSync(target)) {
      changed.push(`${name}: missing after`);
      continue;
    }
    const [a, b] = await Promise.all([raw(path.join(before, name)), raw(target)]);
    if (a.width !== b.width || a.height !== b.height) {
      changed.push(`${name}: size ${a.width}×${a.height} → ${b.width}×${b.height}`);
      continue;
    }
    let differing = 0;
    const overlay = Buffer.from(a.data);
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (delta > 2) {
        differing++;
        overlay[i] = 255;
        overlay[i + 1] = 0;
        overlay[i + 2] = 0;
        overlay[i + 3] = 255;
      }
    }
    if (differing) {
      changed.push(`${name}: ${differing} pixels differ`);
      if (diffDir)
        await sharp(overlay, { raw: { width: a.width, height: a.height, channels: 4 } })
          .png()
          .toFile(path.join(diffDir, name));
    }
  }
  console.log(`${names.length - changed.length} of ${names.length} screens identical.`);
  for (const line of changed) console.log(`  ${line}`);
  process.exitCode = changed.length ? 1 : 0;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'capture' && args[0]) await capture(args[0]);
else if (command === 'compare' && args[0] && args[1]) await compare(args[0], args[1], args[2]);
else {
  console.error(
    'Usage: node scripts/visual-compare.mjs capture <dir> | compare <before> <after> [diff-dir]',
  );
  process.exitCode = 2;
}
