import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { WebAnalytics } = load('src/features/product-analytics/web-analytics.tsx', {
  '@vercel/analytics/next': { Analytics: () => null },
});
const { beforeSend } = WebAnalytics().props;

test('web page views strip search terms, auth parameters and fragments without changing the source event', () => {
  for (const url of [
    'https://www.fixxflow.app/app/tickets?q=private+request&requester=person@example.test',
    'https://www.fixxflow.app/auth/callback?token_hash=private-token&type=invite#access_token=private-token',
  ]) {
    const event = { type: 'pageview', url };
    const result = beforeSend(event);
    assert.equal(result.type, 'pageview');
    assert.equal(result.url, new URL(url).origin + new URL(url).pathname);
    assert.equal(event.url, url);
  }
});

test('web page views retain feature paths while redacting every record ID', () => {
  const result = beforeSend({
    type: 'pageview',
    url: 'https://www.fixxflow.app/app/administration/automations/50000000-0000-0000-0000-000000000401/history/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
  });
  assert.equal(
    result.url,
    'https://www.fixxflow.app/app/administration/automations/[id]/history/[id]',
  );
  assert.equal(beforeSend({ type: 'pageview', url: 'not a URL' }), null);
});
