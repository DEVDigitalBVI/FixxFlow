import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const git = (...arguments_) => execFileSync('git', arguments_, { encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const dirty = git('status', '--porcelain');
if (process.argv.includes('--require-clean'))
  assert.equal(dirty, '', 'Release evidence must be generated from a clean checkout');

const migrationFiles = (await readdir('supabase/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrations = [];
for (const file of migrationFiles)
  migrations.push({ file, sha256: sha256(await readFile(`supabase/migrations/${file}`)) });

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release: git('rev-parse', 'HEAD'),
  branch: process.env.GITHUB_REF_NAME ?? git('branch', '--show-current'),
  clean: dirty === '',
  runtime: { node: process.version },
  packageLockSha256: sha256(await readFile('package-lock.json')),
  migrations,
  automationProcessingEnabled: process.env.AUTOMATION_PROCESSING_ENABLED === 'true',
  ci: process.env.GITHUB_RUN_ID
    ? { runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY }
    : null,
};

const output = argument('output');
if (output) await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
else console.log(JSON.stringify(manifest, null, 2));
