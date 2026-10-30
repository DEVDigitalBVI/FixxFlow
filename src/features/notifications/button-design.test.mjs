import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { renderEmail } = load('src/features/notifications/template.ts');

test('email actions keep escaped labels and destinations with usable inline and Outlook fallbacks', async () => {
  const html = await renderEmail({
    title: 'Ticket ready',
    message: 'Your request is ready.',
    action: 'View ticket & reply',
    href: 'https://fixxflow.com/app/tickets/123?a=1&b=2',
  });
  assert.match(
    html,
    /class="email-action" href="https:\/\/fixxflow.com\/app\/tickets\/123\?a=1&amp;b=2"/,
  );
  assert.match(html, /View ticket &amp; reply<\/a>/);
  assert.equal((html.match(/class="email-action"/g) ?? []).length, 1);
  assert.match(html, /padding:12px 20px;min-height:24px/);
  assert.match(html, /line-height:24px;mso-padding-alt:0/);
  assert.match(html, /mso-padding-alt:12px 20px/);
  assert.match(html, /border:1px solid #d90429;[^>]*background:#d90429;color:#ffffff/);
  assert.match(html, /@media\(max-width:480px\).*?email-action-table\{width:100%/);
  assert.doesNotMatch(html, /<button|role="button"|javascript:/);
});

test('every generated authentication CTA uses the shared responsive email treatment', () => {
  let actions = 0;
  for (const file of fs.readdirSync('supabase/templates')) {
    const html = fs.readFileSync(`supabase/templates/${file}`, 'utf8');
    if (!html.includes('>open this link</a>')) continue;
    actions++;
    assert.match(html, /class="email-action-table"/, file);
    assert.match(html, /class="email-action"/, file);
    assert.match(html, /padding:12px 20px/, file);
    assert.match(html, /mso-padding-alt:12px 20px/, file);
    assert.match(html, /\.email-action:focus\{outline:3px solid #2b2d42/, file);
  }
  assert.equal(actions, 5);
});
