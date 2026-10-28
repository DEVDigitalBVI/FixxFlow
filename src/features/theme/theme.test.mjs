import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import { load } from '../../../tests/helpers/load-module.mjs';
import { productStyles } from '../../../tests/helpers/styles.mjs';

const theme = load('src/features/theme/theme.ts');
test('first paint honors saved choices and falls back safely to the system', () => {
  for (const [saved, dark, blocked, expected] of [
    ['dark', false, false, 'dark'],
    ['light', true, false, 'light'],
    ['system', true, false, 'dark'],
    [null, false, false, 'light'],
    ['invalid', true, false, 'dark'],
    [null, true, true, 'dark'],
  ]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(theme.themeScript, {
      document,
      window: { matchMedia: () => ({ matches: dark }) },
      localStorage: {
        getItem: () => {
          if (blocked) throw Error('blocked');
          return saved;
        },
      },
    });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
});
test('appearance is a labeled icon-button group with all three options', () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const html = renderToStaticMarkup(React.createElement(ThemeControl));
  assert.match(html, /role="group"/);
  assert.match(html, /Appearance/);
  for (const label of ['System', 'Light', 'Dark'])
    assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<select/);
});
test('theme responds to system changes and cross-tab updates, then cleans up listeners', () => {
  let effect;
  const handlers = {};
  const media = {
    matches: true,
    addEventListener: (event, fn) => (handlers.media = fn),
    removeEventListener: () => delete handlers.media,
  };
  globalThis.document = { documentElement: { dataset: { themePreference: 'system' } } };
  globalThis.window = {
    matchMedia: () => media,
    addEventListener: (event, fn) => (handlers[event] = fn),
    removeEventListener: (event) => delete handlers[event],
    dispatchEvent: () => {},
  };
  try {
    const { ThemeController } = load('src/features/theme/theme-control.tsx', {
      './theme': theme,
      react: {
        ...React,
        useEffect: (fn) => {
          effect = fn;
        },
      },
    });
    ThemeController();
    const cleanup = effect();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    media.matches = false;
    handlers.media();
    assert.equal(document.documentElement.dataset.theme, 'light');
    handlers.storage({ key: theme.themeStorageKey, newValue: 'dark' });
    handlers.media();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    handlers.storage({ key: null, newValue: null });
    assert.equal(document.documentElement.dataset.themePreference, 'system');
    cleanup();
    assert.deepEqual(handlers, {});
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
function luminance(hex) {
  const rgb = hex
    .match(/[a-f\d]{2}/gi)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test('explicit and system dark themes share the approved yellow-and-charcoal palette', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const explicit = css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
  const system = css.match(/:root:not\(\[data-theme\]\) \{([^}]+)\}/)[1];
  assert.equal(explicit.trim(), system.trim());
  for (const [token, value] of Object.entries({
    canvas: '#212529',
    surface: '#2b3035',
    accent: '#ffd700',
    text: '#ffffff',
    'text-muted': '#adb5bd',
    focus: '#ffd700',
  }))
    assert.ok(explicit.includes(`--color-${token}: ${value};`), token);
});
test('dark text, states, buttons, charts and focus meet contrast thresholds', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const block = css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
  const tokens = Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+): (#[\da-f]+);/g)].map((m) => [m[1], m[2]]),
  );
  for (const surface of ['canvas', 'surface', 'surface-subtle', 'surface-raised']) {
    for (const text of ['text', 'text-muted', 'accent'])
      assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${text} on ${surface}`);
    for (const cue of ['focus', 'control-border', 'success'])
      assert.ok(contrast(tokens[cue], tokens[surface]) >= 3, `${cue} on ${surface}`);
  }
  for (const state of [
    'accent',
    'active',
    'success',
    'warning',
    'danger',
    'highlight',
    'purple',
    'neutral',
  ]) {
    const surface = ['active', 'danger', 'highlight'].includes(state)
      ? `${state}-surface`
      : `${state}-subtle`;
    assert.ok(contrast(tokens[state], tokens[surface]) >= 4.5, state);
  }
  for (const fill of ['accent', 'accent-hover'])
    assert.ok(contrast(tokens['on-accent'], tokens[fill]) >= 4.5, fill);
});
test('light surfaces and yellow filled actions retain readable contrast in both themes', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const read = (block) =>
    Object.fromEntries(
      [...block.matchAll(/--color-([\w-]+): (#[\da-f]+);/g)].map((m) => [m[1], m[2]]),
    );
  const light = read(css.match(/:root \{([^}]+)\}/)[1]);
  const dark = { ...light, ...read(css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1]) };
  for (const theme of [light, dark]) {
    for (const surface of [
      'canvas',
      'surface',
      'surface-subtle',
      'surface-raised',
      'field-surface',
      'field-hover',
    ]) {
      for (const foreground of ['text', 'text-muted', 'text-subtle', 'accent', 'accent-hover']) {
        assert.ok(
          contrast(theme[foreground], theme[surface]) >= 4.5,
          `${foreground} on ${surface}`,
        );
      }
      for (const cue of ['focus', 'control-border'])
        assert.ok(contrast(theme[cue], theme[surface]) >= 3, `${cue} on ${surface}`);
    }
    for (const fill of ['action-fill', 'action-hover'])
      assert.ok(contrast(theme['on-action'], theme[fill]) >= 4.5, fill);
  }
});
test('theme selection persists and remains usable when storage rejects writes', () => {
  for (const blocked of [false, true]) {
    let saved;
    globalThis.document = { documentElement: { dataset: {} } };
    globalThis.window = { dispatchEvent: () => {} };
    globalThis.localStorage = {
      setItem: (key, value) => {
        if (blocked) throw Error('blocked');
        saved = [key, value];
      },
    };
    try {
      const { ThemeControl } = load('src/features/theme/theme-control.tsx', {
        './theme': theme,
        react: { ...React, useSyncExternalStore: () => 'system' },
      });
      const options = ThemeControl().props.children[1];
      const dark = options.props.children.find((child) => child.props['aria-label'] === 'Dark');
      dark.props.onClick();
      assert.equal(document.documentElement.dataset.theme, 'dark');
      assert.equal(document.documentElement.dataset.themePreference, 'dark');
      if (!blocked) assert.deepEqual(saved, [theme.themeStorageKey, 'dark']);
    } finally {
      delete globalThis.document;
      delete globalThis.window;
      delete globalThis.localStorage;
    }
  }
});
test('signed-in navigation exposes appearance after notifications for every role', () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
    '@/features/theme/theme-control': { ThemeControl },
    'next/navigation': { useRouter: () => ({ push() {} }), usePathname: () => '/app' },
    'next/link': { default: (props) => React.createElement('a', props) },
    '@/features/notifications/notification-link': {
      NotificationLink: () =>
        React.createElement('a', { href: '/app/notifications' }, 'Notifications'),
    },
  });
  for (const role of ['administrator', 'technician', 'end_user']) {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceNav, { role, organizationId: 'org', userId: 'user' }),
    );
    assert.ok(html.indexOf('class="theme-options"') > html.indexOf('</nav>'));
    assert.ok(html.indexOf('Notifications') < html.indexOf('class="theme-options"'));
    assert.match(html, /aria-label="Dark"/);
  }
  const owner = renderToStaticMarkup(
    React.createElement(WorkspaceNav, {
      role: 'administrator',
      platform: true,
      organizationId: '',
      userId: 'owner',
    }),
  );
  assert.match(owner, /aria-label="Dark"/);
});
test('profile offers an independent appearance control outside profile-save forms', async () => {
  const { ThemeControl } = load('src/features/theme/theme-control.tsx', { './theme': theme });
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({
      data: { display_name: 'User', department_id: null, location_id: null },
    }),
    order: async () => ({ data: [] }),
  };
  const { default: ProfilePage } = load('src/app/app/profile/page.tsx', {
    '@/features/theme/theme-control': { ThemeControl },
    '@/features/platform/owner-link': { OwnerConsoleLink: () => null },
    '@/components/ui/submit-button': { SubmitButton: () => null },
    '@/features/identity/viewer-avatar': { ViewerAvatar: () => null },
    '@/features/identity/avatar-upload': { AvatarUpload: () => null },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        displayName: 'User',
        email: 'user@example.com',
        id: 'user',
        organizationId: 'org',
      }),
    },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
    './actions': { updateProfile: () => {}, updateUsagePreference: () => {} },
  });
  const tree = await ProfilePage({ searchParams: Promise.resolve({}) });
  const appearance = React.Children.toArray(tree.props.children).find(
    (child) => child.props['aria-labelledby'] === 'appearance-heading',
  );
  assert.ok(appearance);
  const html = renderToStaticMarkup(appearance);
  assert.match(html, /Applies immediately to this browser/);
  assert.match(html, /role="group"/);
  assert.doesNotMatch(html, /<form/);
});
test('brand logo variants use approved artwork at its original proportions', () => {
  const imageProps = [];
  const { BrandLogo } = load('src/components/brand/brand-logo.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
    'next/image': {
      default: ({ preload, ...props }) => {
        imageProps.push({ ...props, preload });
        return React.createElement('img', props);
      },
    },
  });
  for (const variant of ['full', 'full-inverse', 'horizontal', 'compact', 'navigation']) {
    const html = renderToStaticMarkup(
      React.createElement(BrandLogo, { variant, href: '/app', priority: true }),
    );
    if (variant === 'full') {
      assert.match(html, /fixxflow-logo-primary\.png/);
      assert.match(html, /fixxflow-logo-dark-mode-transparent\.png/);
      assert.match(html, /width="1353" height="1334"/);
    } else if (variant === 'full-inverse') {
      assert.match(html, /fixxflow-logo-dark-mode-transparent\.png/);
      assert.doesNotMatch(html, /fixxflow-logo-primary\.png/);
      assert.match(html, /width="1353" height="1334"/);
    } else if (variant === 'horizontal') {
      assert.match(html, /fixxflow-logo-horizontal-full\.png/);
      assert.match(html, /width="2172" height="724"/);
      const asset = fs.readFileSync('public/brand/fixxflow/logo/fixxflow-logo-horizontal-full.png');
      assert.equal(asset.readUInt32BE(16), 2172);
      assert.equal(asset.readUInt32BE(20), 724);
    } else if (variant === 'compact') {
      assert.match(html, /fixxflow-icon-primary\.png/);
      assert.match(html, /width="1139" height="1151"/);
      assert.doesNotMatch(html, /fixxflow-logo-/);
      const asset = fs.readFileSync('public/brand/fixxflow/icon/fixxflow-icon-primary.png');
      assert.equal(asset.readUInt32BE(16), 1139);
      assert.equal(asset.readUInt32BE(20), 1151);
    } else {
      assert.match(html, /brand-logo-navigation-icon/);
      assert.match(html, /fixxflow-icon-primary\.png/);
      assert.match(html, />Fixx</);
      assert.match(html, />Flow</);
      assert.match(html, /IT support in motion/);
      assert.doesNotMatch(html, /fixxflow-logo-horizontal-full\.png/);
    }
    assert.match(html, /aria-label="FixxFlow home"/);
    if (variant !== 'full') assert.equal(imageProps.at(-1).preload, true);
    assert.doesNotMatch(html, /raster-master/);
  }
  // Fingerprints of the product-owner-authorized yellow-and-charcoal brand artwork.
  const approved = {
    primary: '7c2b002b68a9dfbc4f253cf54e493f15e292cf7eaa46385fd70ad1fb3a1d3ecf',
    'dark-mode': '93ce120db191847b89308d5c0a627f0182d8515e7a819a37a38bb776a85259dc',
    'dark-mode-transparent': '93ce120db191847b89308d5c0a627f0182d8515e7a819a37a38bb776a85259dc',
    'horizontal-full': '817a2551ea75272feb956a815a1dc401a0eea603cefd952c39a140c8b528024a',
  };
  for (const [name, fingerprint] of Object.entries(approved)) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(`public/brand/fixxflow/logo/fixxflow-logo-${name}.png`))
        .digest('hex'),
      fingerprint,
    );
  }
});

test('shared logo artwork has transparent surroundings in every theme', async () => {
  const { alphaFingerprints } = JSON.parse(
    fs.readFileSync('public/brand/fixxflow/source/source-notes.json', 'utf8'),
  );
  for (const asset of [
    'logo/fixxflow-logo-primary.png',
    'logo/fixxflow-logo-dark-mode.png',
    'logo/fixxflow-logo-dark-mode-transparent.png',
    'logo/fixxflow-logo-reversed-white.png',
    'logo/fixxflow-logo-horizontal.png',
    'logo/fixxflow-logo-horizontal-full.png',
    'icon/fixxflow-icon-primary.png',
  ]) {
    const { data, info } = await sharp(`public/brand/fixxflow/${asset}`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
    const channel = Buffer.alloc(info.width * info.height);
    for (let i = 3, j = 0; i < data.length; i += info.channels, j++) channel[j] = data[i];
    assert.equal(
      createHash('sha256').update(channel).digest('hex'),
      alphaFingerprints[asset],
      `${asset}: original transparency preserved`,
    );
    for (const [x, y] of [
      [0, 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1],
    ]) {
      assert.equal(alpha(x, y), 0, `${asset}: transparent corners`);
    }
    let clear = 0;
    let opaque = 0;
    for (let i = 3; i < data.length; i += info.channels) {
      if (data[i] === 0) clear++;
      if (data[i] >= 200) opaque++;
    }
    assert.ok(clear / (info.width * info.height) > 0.4, `${asset}: no rectangular matte`);
    assert.ok(opaque / (info.width * info.height) > 0.05, `${asset}: artwork remains visible`);
  }
});

test('product surfaces source FixxFlow artwork through the shared brand component', () => {
  const visit = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? visit(path) : entry.name.endsWith('.tsx') ? [path] : [];
    });
  for (const file of visit('src').filter(
    (file) => file !== 'src/components/brand/brand-logo.tsx',
  )) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\/brand\/fixxflow\/(?:logo|icon)\//, file);
  }
  for (const file of [
    'src/app/(auth)/layout.tsx',
    'src/app/app/layout.tsx',
    'src/app/platform/layout.tsx',
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /<BrandLogo(?![^>]*\bpriority\b)[^>]*>/,
      `${file} should preload its above-the-fold logo`,
    );
  }
  const authLayout = fs.readFileSync('src/app/(auth)/layout.tsx', 'utf8');
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  assert.match(authLayout, /<BrandLogo[^>]*variant="full-inverse"[^>]*priority/);
  assert.doesNotMatch(
    css.match(/\.auth-logo \{[^}]+\}/)?.[0] ?? '',
    /background|padding|border-radius/,
  );
});

test('brand surfaces retain readable navigation, category copy and overview text in both themes', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const light = css.match(/:root \{([^}]+)\}/)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
  const tokens = (block) =>
    Object.fromEntries(
      [...block.matchAll(/--color-([\w-]+): (#[\da-f]+);/g)].map((m) => [m[1], m[2]]),
    );
  const base = tokens(light);
  for (const theme of [base, { ...base, ...tokens(dark) }]) {
    for (const [foreground, background] of [
      ['on-accent', 'accent'],
      ['neutral', 'accent-subtle'],
      ['neutral', 'highlight-surface'],
      ['highlight', 'highlight-surface'],
      ['text', 'highlight-surface'],
    ]) {
      assert.ok(
        contrast(theme[foreground], theme[background]) >= 4.5,
        `${foreground} on ${background}`,
      );
    }
  }
  // Check the lighter end of the actual sRGB overview wash, not just navy.
  const weight =
    Number(css.match(/color-mix\(in srgb, var\(--color-brand-primary\) (\d+)%/)[1]) / 100;
  const channels = (hex) => hex.match(/[a-f\d]{2}/gi).map((v) => parseInt(v, 16));
  const blue = channels(base['brand-primary']),
    navy = channels(base['brand-ink']);
  const end =
    '#' +
    blue
      .map((v, i) =>
        Math.round(v * weight + navy[i] * (1 - weight))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  for (const foreground of ['inverse', 'brand-text-muted', 'brand-secondary']) {
    assert.ok(contrast(base[foreground], end) >= 4.5, `${foreground} on overview wash`);
  }
});

test('rebranded artwork versions are allowed by image optimization and favicon copies agree', () => {
  const component = fs.readFileSync('src/components/brand/brand-logo.tsx', 'utf8');
  const config = fs.readFileSync('next.config.ts', 'utf8');
  const versions = [...component.matchAll(/\?v=([\w-]+)/g)].map((match) => match[1]);
  assert.ok(versions.length >= 4);
  for (const version of versions) assert.ok(config.includes(`search: '?v=${version}'`));
  assert.deepEqual(
    fs.readFileSync('src/app/favicon.ico'),
    fs.readFileSync('public/brand/fixxflow/favicon/favicon.ico'),
  );
  const manifest = JSON.parse(fs.readFileSync('public/brand/fixxflow/site.webmanifest', 'utf8'));
  assert.equal(manifest.theme_color, '#ffd700');
});

test('brand wordmark keeps readable theme accents', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  assert.match(css, /--color-brand-primary: #ffd700;/);
  assert.match(
    css,
    /\.brand-logo-navigation-wordmark span:last-child \{ color: var\(--color-accent\); \}/,
  );
  assert.doesNotMatch(css, /#(?:fff0f1|fff1f1|ffadb5|ffc2c8|42272e|ff9a9a|44262f)\b/i);
});

test('every shipped brand bitmap uses only approved brand colors', async () => {
  const visit = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = `${dir}/${entry.name}`;
      return entry.isDirectory() ? visit(file) : file.endsWith('.png') ? [file] : [];
    });
  const palette = new Set(['255,215,0', '33,37,41', '255,255,255', '173,181,189']);
  for (const file of visit('public/brand/fixxflow')) {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      assert.ok(palette.has(`${data[i]},${data[i + 1]},${data[i + 2]}`), file);
    }
  }
});

test('product styles and email templates cannot reintroduce the retired brand palette', () => {
  const oldPalette = /#(?:bd212c|a71d27|fba917|282d33|fbfffe|6e676f)\b/i;
  assert.doesNotMatch(productStyles(), oldPalette);
  assert.doesNotMatch(productStyles(), /rgb\(189 33 44\b/);
  for (const name of fs.readdirSync('supabase/templates')) {
    if (name.endsWith('.html'))
      assert.doesNotMatch(fs.readFileSync(`supabase/templates/${name}`, 'utf8'), oldPalette, name);
  }
});

test('all five reference colors have explicit shared product roles', () => {
  const css = productStyles();
  for (const [role, value] of Object.entries({
    'brand-primary': '#ffd700',
    'brand-secondary': '#ff9800',
    'brand-ink': '#212529',
    surface: '#ffffff',
  }))
    assert.ok(css.includes(`--color-${role}: ${value};`), `${role} uses ${value}`);
  assert.match(css, /--color-border-strong: #adb5bd;/);
  assert.match(css, /--color-text-muted: #adb5bd;/);
});
