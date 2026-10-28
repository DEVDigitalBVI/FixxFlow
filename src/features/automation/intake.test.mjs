import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import {
  action,
  definition,
  event,
  group,
  registry,
  validateDefinition,
} from '../../../tests/fixtures/automation.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { ticketDryRunEvent } = load('src/features/automation/domains/tickets/dry-run-context.ts');
const { evaluateDryRun } = load('src/features/automation/dry-run.ts');
const portable = load('src/features/automation/portable.ts');
const { actionDescription, newAction } = load('src/features/automation/ui-model.ts');
for (const channel of ['email', 'chat'])
  test(`${channel} trigger validates, exports and simulates only explicit intake`, () => {
    const value = definition({
      trigger: { type: `ticket.created_from_${channel}`, configuration: {} },
      conditions: group(),
      actions: [action('suggest_articles', {})],
    });
    assert.equal(validateDefinition(value, registry).valid, true);
    const pkg = portable.exportPortablePackage(value, {}, '2026-10-01T12:00:00Z');
    assert.equal(pkg.rules[0].trigger.type, value.trigger.type);
    assert.deepEqual(pkg.rules[0].actions[0].configuration, {});
    const context = {
      definition: value,
      organizationId: event().organizationId,
      ticketId: event().entityId,
      revision: 1,
      snapshot: event().after,
      conditionsReferencesValid: true,
      actionReferences: [{ actionId: value.actions[0].id, valid: true }],
      ruleId: null,
    };
    const input = ticketDryRunEvent(context, { kind: 'current_ticket' });
    assert.equal(input.type, value.trigger.type);
    const result = evaluateDryRun(context, input, { kind: 'current_ticket' }, registry);
    assert.ok(JSON.stringify(result).includes('selected intake channel is simulated'));
    assert.ok(JSON.stringify(result).includes('No reply is sent'));
  });
test('article reply is limited to creation triggers and has no editable or exportable secret configuration', () => {
  assert.equal(
    validateDefinition(
      definition({
        trigger: { type: 'ticket.updated', configuration: {} },
        actions: [action('suggest_articles', {})],
      }),
      registry,
    ).valid,
    false,
  );
  assert.equal(
    validateDefinition(
      definition({ actions: [action('suggest_articles', { body: 'Fake guide' })] }),
      registry,
    ).valid,
    false,
  );
  assert.deepEqual(newAction('guides', 0, 'suggest_articles').configuration, {});
  assert.equal(
    actionDescription(action('suggest_articles', {})),
    'Reply with relevant employee guides, if available',
  );
});
test('trusted guide replies render named local links; malformed or external URLs remain escaped text', () => {
  const { ArticleSuggestionReply } = load('src/features/tickets/article-suggestion-reply.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
  });
  const id = '60000000-0000-0000-0000-000000000401';
  const html = render(
    React.createElement(ArticleSuggestionReply, {
      body: `Guides\n\nWi-Fi <reset>\nhttps://fixxflow.com/app/help/${id}\n\nBad\nhttps://evil.invalid/${id}\n\n<script>evil()</script>`,
    }),
  );
  assert.match(html, new RegExp(`href="/app/help/${id}"`));
  assert.match(html, /Wi-Fi &lt;reset&gt;/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.ok(!html.includes('<script>'));
});
