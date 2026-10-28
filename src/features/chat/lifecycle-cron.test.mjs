import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

test('chat cron rejects unauthorized callers and exposes only bounded counts and safe failures', async () => {
  let authorized = false,
    fail = false,
    calls = 0;
  const { GET } = load('src/app/api/cron/chats/route.ts', {
    '@/lib/cron-auth': { isCronAuthorized: () => authorized },
    '@/lib/server-errors': {
      reportServerError: (operation) => {
        assert.equal(operation, 'chat.idle');
        return 'safe-ref';
      },
    },
    '@/lib/supabase/admin': {
      createAdminClient: () => {
        calls++;
        return {
          rpc: async (name, args) => {
            assert.equal(name, 'process_idle_chats');
            assert.deepEqual(args, { batch_size: 100 });
            return fail
              ? { error: new Error('private connection information') }
              : { data: { checked: 10, warned: 1, closed: 2 }, error: null };
          },
        };
      },
    },
  });
  const request = new Request('https://example.test/api/cron/chats');
  assert.equal((await GET(request)).status, 401);
  assert.equal(calls, 0);
  authorized = true;
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checked: 10, warned: 1, closed: 2 });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  fail = true;
  const failure = await GET(request);
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /private connection/);
});
