import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { automationArtifacts } from '../../../tests/helpers/automation-artifacts.mjs';
import { renderCompactPreview } from '../../../tests/helpers/compact-preview.mjs';

function fixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'fixxflow-artifact-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, directory: path.join(parent, 'artifacts') };
}

test('private artifacts preserve report updates and cross-process reads', async t => {
  const { directory } = fixture(t), store = automationArtifacts(directory);
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  store.write('report.json', JSON.stringify({ result: 'RUNNING' }));
  store.write('report.json', JSON.stringify({ result: 'PASS' }));
  assert.deepEqual(JSON.parse(store.read('report.json', 'utf8')), { result: 'PASS' });
  assert.equal(lstatSync(store.path('report.json')).mode & 0o777, 0o600);
  assert.equal(await childStore(directory, "console.log(store.read('report.json','utf8'))"), '{"result":"PASS"}');
  assert.deepEqual(readdirSync(directory), ['report.json']);
});

test('storage rejects traversal, symlink roots and permissive roots', t => {
  const { parent, directory } = fixture(t), store = automationArtifacts(directory);
  for (const name of ['../target', '/absolute', 'nested/file', '..', '']) {
    assert.throws(() => store.write(name, 'bad'), /Invalid automation artifact name/);
  }
  const alias = path.join(parent, 'alias');
  symlinkSync(directory, alias);
  assert.throws(() => automationArtifacts(alias), /owned private directory/);
  assert.throws(() => automationArtifacts(alias + path.sep), /owned private directory/);
  chmodSync(directory, 0o755);
  assert.throws(() => automationArtifacts(directory), /owned private directory/);
});

test('pre-created symlinks and hardlinks cannot overwrite other files', t => {
  const { parent, directory } = fixture(t), store = automationArtifacts(directory);
  const target = path.join(parent, 'target');
  writeFileSync(target, 'unchanged', { mode: 0o600 });
  symlinkSync(target, store.path('symlink'));
  linkSync(target, store.path('hardlink'));
  for (const name of ['symlink', 'hardlink']) assert.throws(() => store.write(name, 'bad'), /private regular file/);
  assert.throws(() => store.read('symlink', 'utf8'));
  assert.throws(() => store.secret('symlink'));
  assert.equal(readFileSync(target, 'utf8'), 'unchanged');
  assert.deepEqual(readdirSync(directory).sort(), ['hardlink', 'symlink']);
});

test('storage rejects unsafe files and never follows directory entries', t => {
  const { directory } = fixture(t), store = automationArtifacts(directory);
  writeFileSync(store.path('public'), 'not private', { mode: 0o644 });
  chmodSync(store.path('public'), 0o644);
  mkdirSync(store.path('folder'));
  for (const name of ['public', 'folder']) {
    assert.throws(() => store.read(name, 'utf8'), /private regular file/);
    assert.throws(() => store.write(name, 'bad'), /private regular file/);
  }
  store.write('invalid-secret', 'incomplete');
  assert.throws(() => store.secret('invalid-secret'), /Invalid automation cron secret/);
});

function childStore(directory, code) {
  const moduleUrl = new URL('../../../tests/helpers/automation-artifacts.mjs', import.meta.url).href;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import {automationArtifacts} from ${JSON.stringify(moduleUrl)}; const store=automationArtifacts(${JSON.stringify(directory)}); ${code}`]);
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
  });
}

test('concurrent secret creators publish one complete persistent value', async t => {
  const { directory } = fixture(t);
  const values = await Promise.all(Array.from({ length: 8 }, () => childStore(directory, "console.log(store.secret('cron.private'))")));
  assert.equal(new Set(values).size, 1);
  assert.match(values[0], /^[a-f0-9]{64}$/);
  const store = automationArtifacts(directory), before = lstatSync(store.path('cron.private'));
  assert.equal(store.secret('cron.private'), values[0]);
  assert.equal(lstatSync(store.path('cron.private')).ino, before.ino);
  assert.equal(before.mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['cron.private']);
});

test('compact preview escapes hostile HTML and round-trips URL parameter boundaries', () => {
  for (const payload of ['"><script>alert(1)</script>', "' onload='alert(1)", '<IMG SRC=x ONERROR=alert(1)>', '&role=administrator#fragment']) {
    const params = new URLSearchParams({ role: payload, theme: payload, surface: payload, width: '390' });
    const html = renderCompactPreview(params);
    assert.doesNotMatch(html, /<script|<img|" onload=/i);
    assert.equal((html.match(/<iframe\b/gi) || []).length, 1);
    const attribute = html.match(/<iframe[^>]+src="([^"]+)"/)[1].replaceAll('&amp;', '&');
    const url = new URL(attribute, 'http://127.0.0.1');
    for (const name of ['role', 'theme', 'surface']) assert.equal(url.searchParams.get(name), payload);
    assert.equal(url.searchParams.get('view'), 'all');
    assert.equal(url.hash, '');
  }
});

test('compact preview retains ordinary fixture controls and safe width fallbacks', () => {
  const html = renderCompactPreview(new URLSearchParams({ role: 'employee', theme: 'dark', surface: 'chat-fixes', width: '768' }));
  assert.match(html, /768px employee dark fixture/);
  assert.match(html, /width:768px;height:850px/);
  assert.match(html, /role=employee&amp;theme=dark&amp;surface=chat-fixes/);
  for (const width of ['Infinity', '-1', 'NaN', '0', '']) {
    assert.match(renderCompactPreview(new URLSearchParams({ width })), /width:390px/);
  }
});

test('automation helpers keep generated files out of shared system temp paths', () => {
  for (const name of readdirSync('tests/helpers').filter(name => /^automation-stage12.*\.mjs$/.test(name))) {
    const source = readFileSync(path.join('tests/helpers', name), 'utf8');
    assert.doesNotMatch(source, /(?:writeFile(?:Sync)?|openSync)\(["'`]\/tmp\/fixxflow-/, name);
    assert.doesNotMatch(source, /existsSync\(secretFile\)/, name);
    // A producer must not move without its cooperating session/secret/report readers.
    assert.doesNotMatch(source, /readFileSync\(["'`]\/tmp\/fixxflow-.*(?:test-session|cron|results|dry-run-before)/, name);
  }
});
