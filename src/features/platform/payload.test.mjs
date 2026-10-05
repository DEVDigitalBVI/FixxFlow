import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

test('platform RPC rejects malformed counts, rows and timestamps before rendering', () => {
  const { isPlatformData } = load('src/features/platform/payload.ts');
  const valid = {
    organizationCount: 1, matchingCount: 1,
    organizations: [{ id: 'org', name: 'Company', slug: 'company', created_at: '2026-09-27T12:00:00Z', members: 1 }],
    usage: [{ event: 'login', role: 'end_user', surface: 'auth', count: 3 }],
    audit: [{ id: 1, actor_id: 'owner', organization_id: null, action: 'organization_created', details: { name: 'Company', slug: null }, created_at: '2026-09-27T12:00:00Z' }],
  };
  assert.equal(isPlatformData(valid), true);
  for (const invalid of [null, {}, { ...valid, organizationCount: '1' }, { ...valid, usage: [{}] },
    { ...valid, audit: [{ ...valid.audit[0], created_at: 'invalid' }] },
    { ...valid, organizations: [{ ...valid.organizations[0], members: NaN }] }]) assert.equal(isPlatformData(invalid), false);
});
