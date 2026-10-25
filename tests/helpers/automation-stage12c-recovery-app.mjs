/** Local verification launcher. No repository .env or hosted project links. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { automationSecret } from './automation-artifacts.mjs';
import { local } from './automation-stage12c-recovery-env.mjs';

const directory = '/tmp/fixxflow-stage12c-recovery-app';
assert.equal(existsSync(`${directory}/.env.local`), false);
assert.equal(existsSync(`${directory}/.vercel`), false);
const cronSecret = automationSecret('fixxflow-stage12c-recovery-cron.private');
const building = process.argv[2] === 'build';
assert.ok(building || ['off', 'controlled-test'].includes(process.argv[2]));
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3102',
  SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
  AUTOMATION_PROCESSING_ENABLED:
    !building && process.argv[2] === 'controlled-test' ? 'true' : 'false',
  CRON_SECRET: cronSecret,
  RESEND_API_KEY: '',
  NOTIFICATIONS_FROM_EMAIL: '',
};
const child = spawn(
  process.execPath,
  [
    `${directory}/node_modules/next/dist/bin/next`,
    ...(building ? ['build', '--webpack'] : ['start', '-H', '127.0.0.1', '-p', '3102']),
  ],
  { cwd: directory, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
