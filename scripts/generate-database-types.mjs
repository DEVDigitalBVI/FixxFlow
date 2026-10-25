import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Capture output first: a failed CLI/authentication request must not truncate types.
const cli = process.platform === 'win32' ? 'supabase.cmd' : 'supabase';
const source = process.argv[2] ?? '--linked';
if (process.argv.length > 3 || !['--linked', '--local'].includes(source)) {
  throw new Error('Usage: npm run db:types -- [--linked|--local]');
}
const types = execFileSync(cli, ['gen', 'types', 'typescript', source, '--schema', 'public'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  maxBuffer: 10 * 1024 * 1024,
});
if (!types.includes('export type Database')) throw new Error('Invalid database type output');
writeFileSync(
  new URL('../src/types/database.generated.ts', import.meta.url),
  types.trimEnd() + '\n',
);
console.log(`Regenerated database types from the ${source.slice(2)} Supabase database.`);
