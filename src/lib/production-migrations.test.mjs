import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkProductionMigrations,
  missingMigrations,
} from '../../scripts/check-production-migrations.mjs';

test('migration gate checks every migration, including gaps below the latest version', () => {
  assert.deepEqual(
    missingMigrations(
      ['1_first.sql', '2_second.sql', '3_third.sql'],
      [{ version: '1' }, { version: '3' }],
    ),
    ['2_second.sql'],
  );
  assert.deepEqual(missingMigrations(['1_first.sql'], [{ version: '99', name: 'first' }]), []);
  assert.throws(() => missingMigrations(['1_first.sql'], {}), /Invalid migration history/);
});

test('production gate fails closed for missing credentials, API errors and missing migrations', async () => {
  await assert.rejects(
    checkProductionMigrations({ VERCEL_ENV: 'production' }),
    /SUPABASE_ACCESS_TOKEN/,
  );
  const env = {
    VERCEL_ENV: 'production',
    SUPABASE_ACCESS_TOKEN: 'test-only',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  };
  await assert.rejects(
    checkProductionMigrations(env, async () => ({ ok: false, status: 403 })),
    /HTTP 403/,
  );
  await assert.rejects(
    checkProductionMigrations(env, async () => ({ ok: true, json: async () => [] })),
    /missing migrations/,
  );
  await checkProductionMigrations({ VERCEL_ENV: 'preview' }, () => {
    throw new Error('Preview must not query production');
  });
});
