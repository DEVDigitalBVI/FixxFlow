import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../tests/helpers/load-module.mjs';

const { renderEmail } = load('src/features/notifications/template.ts');

test('notes after text or a code use the preceding block gap, while action notes retain a section gap', async () => {
  const base = {
    title: 'Account update',
    message: 'Your update is ready.',
    note: 'Keep this message for reference.',
  };
  for (const extra of [{}, { code: '123456' }]) {
    const html = await renderEmail({ ...base, ...extra });
    assert.match(
      html,
      /<p style="text-align:left;margin:0;color:[^>]+>Keep this message for reference\.<\/p>/,
    );
  }
  const action = await renderEmail({
    ...base,
    action: 'Open FixxFlow',
    href: 'https://fixxflow.com/app',
  });
  assert.match(
    action,
    /<p style="text-align:left;margin:24px 0 0;color:[^>]+>Keep this message for reference\.<\/p>/,
  );
});

test('a security notice after plain text has no additional top gap and retains its warning semantics', async () => {
  const html = await renderEmail({
    title: 'Password changed',
    message: 'Your password was changed.',
    purpose: 'security-alert',
    note: 'Contact support if this was not you.',
  });
  assert.match(html, /<table role="presentation"[^>]*style="margin:0"/);
  assert.match(html, /<h2[^>]*>Security notice<\/h2>/);
  assert.match(html, /Contact support if this was not you\./);
});

test('long detail labels and values have top-aligned rows and a bounded table layout', async () => {
  const html = await renderEmail({
    title: 'Ticket update',
    message: 'Review the details.',
    details: [
      { label: 'Response service-level deadline', value: 'Tomorrow' },
      { label: 'Requester', value: 'LongName'.repeat(30) },
    ],
  });
  assert.match(html, /table-layout:fixed/);
  assert.match(html, /<th scope="row"[^>]*vertical-align:top/);
  assert.match(
    html,
    /<td style="padding:8px 0;color:[^>]+vertical-align:top;overflow-wrap:anywhere"/,
  );
  assert.match(
    html,
    /@media\(max-width:480px\).*?email-content\{padding:24px 16px 16px!important\}/,
  );
});
