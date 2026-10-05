import { load } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const theme = load('src/features/theme/theme.ts');
test('first paint honors saved choices and falls back safely to the system', () => {
  for (const [saved, dark, blocked, expected] of [
    ['dark', false, false, 'dark'], ['light', true, false, 'light'],
    ['system', true, false, 'dark'], [null, false, false, 'light'],
    ['invalid', true, false, 'dark'], [null, true, true, 'dark'],
  ]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(theme.themeScript, { document, window: { matchMedia: () => ({ matches: dark }) }, localStorage: { getItem: () => { if (blocked) throw Error('blocked'); return saved; } } });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
});
test('appearance is a labeled icon-button group with all three options', () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const html = renderToStaticMarkup(React.createElement(ThemeControl));
  assert.match(html, /role="group"/); assert.match(html, /Appearance/);
  for (const label of ['System', 'Light', 'Dark']) assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<select/);
});
test('theme responds to system changes and cross-tab updates, then cleans up listeners', () => {
  let effect;
  const handlers = {};
  const media = { matches: true, addEventListener: (event, fn) => handlers.media = fn, removeEventListener: () => delete handlers.media };
  globalThis.document = { documentElement: { dataset: { themePreference: 'system' } } };
  globalThis.window = { matchMedia: () => media, addEventListener: (event, fn) => handlers[event] = fn, removeEventListener: event => delete handlers[event], dispatchEvent: () => {} };
  try {
    const { ThemeController } = load('src/features/theme/theme-control.tsx', { './theme': theme, react: { ...React, useEffect: fn => { effect = fn; } } });
    ThemeController(); const cleanup = effect();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    media.matches = false; handlers.media(); assert.equal(document.documentElement.dataset.theme, 'light');
    handlers.storage({ key: theme.themeStorageKey, newValue: 'dark' });
    handlers.media(); assert.equal(document.documentElement.dataset.theme, 'dark');
    handlers.storage({ key: null, newValue: null }); assert.equal(document.documentElement.dataset.themePreference, 'system');
    cleanup(); assert.deepEqual(handlers, {});
  } finally { delete globalThis.document; delete globalThis.window; }
});
function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x,y) + .05) / (Math.min(x,y) + .05); }
test('dark text, states, buttons, charts and focus meet contrast thresholds', () => {
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  const block = css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
  const tokens = Object.fromEntries([...block.matchAll(/--color-([\w-]+): (#[\da-f]+);/g)].map(m => [m[1], m[2]]));
  for (const surface of ['canvas', 'surface', 'surface-subtle', 'surface-raised']) {
    for (const text of ['text', 'text-muted', 'accent']) assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${text} on ${surface}`);
    for (const cue of ['focus', 'control-border', 'success']) assert.ok(contrast(tokens[cue], tokens[surface]) >= 3, `${cue} on ${surface}`);
  }
  for (const state of ['accent', 'success', 'warning', 'danger', 'cyan', 'purple', 'neutral']) assert.ok(contrast(tokens[state], tokens[`${state}-subtle`]) >= 4.5, state);
  for (const fill of ['accent', 'accent-hover']) assert.ok(contrast(tokens['on-accent'], tokens[fill]) >= 4.5, fill);
});
test('theme selection persists and remains usable when storage rejects writes', () => {
  for (const blocked of [false, true]) {
    let saved;
    globalThis.document = { documentElement: { dataset: {} } };
    globalThis.window = { dispatchEvent: () => {} };
    globalThis.localStorage = { setItem: (key, value) => { if (blocked) throw Error('blocked'); saved = [key, value]; } };
    try {
      const { ThemeControl } = load('src/features/theme/theme-control.tsx', {
        './theme': theme, react: { ...React, useSyncExternalStore: () => 'system' },
      });
      const options = ThemeControl().props.children[1];
      const dark = options.props.children.find(child => child.props['aria-label'] === 'Dark');
      dark.props.onClick();
      assert.equal(document.documentElement.dataset.theme, 'dark');
      assert.equal(document.documentElement.dataset.themePreference, 'dark');
      if (!blocked) assert.deepEqual(saved, [theme.themeStorageKey, 'dark']);
    } finally { delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; }
  }
});
test('signed-in navigation exposes appearance after notifications for every role', () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
    '@/features/theme/theme-control': { ThemeControl },
    'next/navigation': { usePathname: () => '/app' },
    'next/link': { default: props => React.createElement('a', props) },
    '@/features/notifications/notification-link': { NotificationLink: () => React.createElement('a', { href: '/app/notifications' }, 'Notifications') },
  });
  for (const role of ['administrator', 'technician', 'end_user']) {
    const html = renderToStaticMarkup(React.createElement(WorkspaceNav, { role, organizationId: 'org', userId: 'user' }));
    assert.ok(html.indexOf('class="theme-options"') > html.indexOf('</nav>'));
    assert.ok(html.indexOf('Notifications') < html.indexOf('class="theme-options"'));
    assert.match(html, /aria-label="Dark"/);
  }
  const owner = renderToStaticMarkup(React.createElement(WorkspaceNav, { role: 'administrator', platform: true, organizationId: '', userId: 'owner' }));
  assert.match(owner, /aria-label="Dark"/);
});
test('profile offers an independent appearance control outside profile-save forms', async () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { display_name: 'User', department_id: null, location_id: null } }), order: async () => ({ data: [] }) };
  const { default: ProfilePage } = load('src/app/app/profile/page.tsx', {
    '@/features/theme/theme-control': { ThemeControl },
    '@/features/platform/owner-link': { OwnerConsoleLink: () => null },
    '@/components/ui/submit-button': { SubmitButton: () => null },
    '@/features/identity/viewer-avatar': { ViewerAvatar: () => null },
    '@/features/identity/avatar-upload': { AvatarUpload: () => null },
    '@/lib/auth/viewer': { requireViewer: async () => ({ displayName: 'User', email: 'user@example.com', id: 'user', organizationId: 'org' }) },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
    './actions': { updateProfile: () => {}, updateUsagePreference: () => {} },
  });
  const tree = await ProfilePage({ searchParams: Promise.resolve({}) });
  const appearance = React.Children.toArray(tree.props.children).find(child => child.props['aria-labelledby'] === 'appearance-heading');
  assert.ok(appearance);
  const html = renderToStaticMarkup(appearance);
  assert.match(html, /Changes apply immediately/);
  assert.match(html, /role="group"/);
  assert.doesNotMatch(html, /<form/);
});
test('shared logos use the approved theme pair at their original proportions', () => {
  const { BrandLogo } = load('src/components/brand/brand-logo.tsx', {
    'next/link': { default: props => React.createElement('a', props) },
    'next/image': { default: props => React.createElement('img', props) },
  });
  for (const variant of ['full', 'compact']) {
    const html = renderToStaticMarkup(React.createElement(BrandLogo, { variant, href: '/app', priority: true }));
    assert.match(html, /fixxflow-logo-primary\.png/);
    assert.match(html, /fixxflow-logo-dark-mode\.png/);
    assert.match(html, /width="1353" height="1334"/);
    assert.match(html, /aria-label="FixxFlow home"/);
    assert.doesNotMatch(html, /raster-master|icon-primary/);
  }
  for (const name of ['primary', 'dark-mode']) {
    assert.deepEqual(fs.readFileSync(`public/brand/fixxflow/logo/fixxflow-logo-${name}.png`), fs.readFileSync(`brand/fixxflow/logo/fixxflow-logo-${name}.png`));
  }
});
