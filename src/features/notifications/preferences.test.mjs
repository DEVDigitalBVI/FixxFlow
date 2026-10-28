import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { parseNotificationPreferences, defaultNotificationPreferences } = load(
  'src/features/notifications/preferences-model.ts',
);
const initial = defaultNotificationPreferences('America/Tortola');
const data = (changes = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    ...initial,
    digest_hour: '8',
    quiet_enabled: 'on',
    urgent_immediate: 'on',
    ...changes,
  }))
    f.set(k, String(v));
  return f;
};
test('email preference parser validates times, timezone and frequency without silently treating missing hours as midnight', () => {
  assert.equal(parseNotificationPreferences(data()).digest_hour, 8);
  for (const changes of [
    { email_mode: 'weekly' },
    { digest_hour: '' },
    { digest_hour: '24' },
    { quiet_start: '24:00' },
    { quiet_end: '22:00' },
    { timezone: 'Unknown/Timezone' },
  ])
    assert.equal(parseNotificationPreferences(data(changes)), null);
  assert.equal(
    parseNotificationPreferences(data({ email_mode: 'off', quiet_enabled: '' })).quiet_enabled,
    false,
  );
});
test('preference controls preserve edited times across mode switches and carry the new revision after save', async () => {
  const actions = '@/app/app/notifications/settings/actions';
  const h = componentHarness(
    'src/features/notifications/preferences-form.tsx',
    'NotificationPreferencesForm',
    { initial, revision: 0 },
    {
      [actions]: { saveNotificationPreferences: async () => ({ success: 'Saved', revision: 1 }) },
      './preferences.module.css': { default: { scope: 'scope' } },
    },
  );
  try {
    const mode = () => h.find((n) => n.type === 'select' && n.props.name === 'email_mode');
    mode().props.onChange({ target: { value: 'daily' } });
    h.render();
    assert.equal(
      h.find((n) => n.type === 'select' && n.props.name === 'digest_hour').props.disabled,
      false,
    );
    h.find((n) => n.type === 'select' && n.props.name === 'digest_hour').props.onChange({
      target: { value: '9' },
    });
    h.render();
    mode().props.onChange({ target: { value: 'off' } });
    h.render();
    assert.equal(
      h.find((n) => n.type === 'input' && n.props.name === 'digest_hour').props.value,
      9,
    );
    assert.ok(h.find((n) => n.type === 'fieldset').props.disabled);
    mode().props.onChange({ target: { value: 'daily' } });
    h.render();
    assert.equal(
      h.find((n) => n.type === 'select' && n.props.name === 'digest_hour').props.value,
      9,
    );
    await h
      .find((n) => typeof n.type === 'function' && n.type.name === 'ActionForm')
      .props.action(new FormData());
    h.render();
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 1);
  } finally {
    h.close();
  }
});
test('settings use semantic labels, scoped hidden rules and the shared form, timezone and submit controls', () => {
  const { NotificationPreferencesForm } = load('src/features/notifications/preferences-form.tsx', {
    '@/app/app/notifications/settings/actions': { saveNotificationPreferences() {} },
    './preferences.module.css': { default: { scope: 'notification-scope' } },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
  });
  const html = render(React.createElement(NotificationPreferencesForm, { initial, revision: 0 }));
  assert.match(html, /Notification timezone<select/);
  assert.match(html, /Daily summary time<select[^>]*disabled/);
  assert.match(
    html,
    /<input(?=[^>]*type="time")(?=[^>]*name="quiet_start")(?=[^>]*disabled)[^>]*>/,
  );
  assert.match(html, /In-app updates stay available/);
});
