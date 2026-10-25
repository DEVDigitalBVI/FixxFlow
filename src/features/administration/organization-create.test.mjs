import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

function actions(role = 'administrator', error = null) {
  const inserted = [],
    refreshed = [];
  return {
    inserted,
    refreshed,
    ...load('src/app/app/organization/actions.ts', {
      'next/cache': { revalidatePath: (path) => refreshed.push(path) },
      'next/navigation': {
        redirect() {
          throw Error('Unexpected redirect');
        },
      },
      '@/lib/auth/viewer': {
        requireViewer: async () => ({
          role,
          organizationId: 'org',
          organizationTimezone: 'America/Tortola',
        }),
      },
      '@/lib/supabase/server': {
        createClient: async () => ({
          from: (table) => ({
            insert: async (row) => {
              inserted.push({ table, row });
              return { error };
            },
          }),
        }),
      },
    }),
  };
}
const form = (values) => {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
};
test('creation returns field-specific validation without redirecting or inserting invalid data', async () => {
  const f = actions();
  const result = await f.addLocation(form({ name: '', countryCode: 'XYZ', timezone: 'invalid' }));
  assert.deepEqual(Object.keys(result.fieldErrors).sort(), ['countryCode', 'name', 'timezone']);
  assert.deepEqual(f.inserted, []);
});
test('duplicate names and transient failures return recoverable feedback; successful writes refresh the list', async () => {
  const duplicate = await actions('administrator', { code: '23505' }).addDepartment(
    form({ name: 'Engineering' }),
  );
  assert.equal(duplicate.fieldErrors.name, 'Choose a different name.');
  assert.match(
    (await actions('administrator', {}).addDepartment(form({ name: 'Engineering' }))).error,
    /preserved/,
  );
  const f = actions();
  assert.equal(
    (await f.addLocation(form({ name: 'Office', countryCode: 'vg', timezone: 'America/Tortola' })))
      .success,
    'Location added.',
  );
  assert.equal(f.inserted[0].row.country_code, 'VG');
  assert.deepEqual(f.refreshed, ['/app/organization']);
});
test('non-administrators cannot create organization records', async () => {
  const f = actions('end_user');
  assert.match((await f.addDepartment(form({ name: 'Engineering' }))).error, /Only administrators/);
  assert.deepEqual(f.inserted, []);
});
