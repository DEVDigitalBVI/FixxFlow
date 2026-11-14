import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function missingMigrations(files, applied) {
  if (!Array.isArray(applied) || applied.some((row) => typeof row?.version !== 'string'))
    throw new Error('Invalid migration history response');
  return files.filter((file) => {
    const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(file) ?? [];
    if (!version) throw new Error(`Invalid migration filename: ${file}`);
    // The connector assigns its own version when applying an existing migration.
    // Accept a unique matching name; never rely on the newest timestamp alone.
    return (
      !applied.some((row) => row.version === version) &&
      applied.filter((row) => row.name === name).length !== 1
    );
  });
}

export async function checkProductionMigrations(env = process.env, request = fetch) {
  if (env.VERCEL_ENV !== 'production' && !process.argv.includes('--required')) return;
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token)
    throw new Error(
      'Production migration gate requires server-only SUPABASE_ACCESS_TOKEN (database:read).',
    );
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!/^[a-z]{20}\.supabase\.co$/.test(url.hostname) || url.protocol !== 'https:')
    throw new Error('Production migration gate requires a hosted Supabase project URL.');
  const ref = url.hostname.split('.')[0];
  const response = await request(
    `https://api.supabase.com/v1/projects/${ref}/database/migrations`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Migration history check failed (HTTP ${response.status}).`);
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const missing = missingMigrations(files, await response.json());
  if (missing.length)
    throw new Error(
      `Production is missing migrations:\n${missing.join('\n')}\nApply and verify them before deploying, then rerun the build.`,
    );
  console.log(`Production migration gate passed: ${files.length} migrations applied.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkProductionMigrations().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
