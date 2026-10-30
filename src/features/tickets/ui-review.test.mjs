import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';
import { productStyles } from '../../../tests/helpers/styles.mjs';

const navMocks = {
  '@/features/search/global-search': { GlobalSearch: () => null },
  '@/features/theme/theme-control': { ThemeControl: () => null },
  'next/navigation': { useRouter: () => ({ push() {} }), usePathname: () => '/app/tickets' },
  'next/link': { default: (props) => React.createElement('a', props) },
  '@/features/notifications/notification-link': {
    NotificationLink: () =>
      React.createElement('a', { href: '/app/notifications' }, 'Notifications'),
  },
};
test('employee navigation keeps employee labels and excludes staff destinations', () => {
  const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', navMocks);
  const html = renderToStaticMarkup(
    React.createElement(WorkspaceNav, { role: 'end_user', organizationId: 'org', userId: 'user' }),
  );
  for (const text of ['Home', 'My requests', 'My chats', 'Help articles', 'Account', 'Security'])
    assert.ok(html.includes(text));
  assert.doesNotMatch(html, /href="\/app\/(administration|people)"/);
  assert.match(html, /aria-label="Employee navigation"/);
});
test('mobile menu uses the kit sheet: modal dialog, close control, inert page and Tab cycling', () => {
  let effect;
  const main = { inert: false };
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
    ...navMocks,
    react: {
      ...React,
      useState: () => [true, () => {}],
      useRef: () => ({ current: null }),
      useEffect: (fn) => {
        effect ??= fn;
      },
    },
  });
  const tree = WorkspaceNav({ role: 'administrator', organizationId: 'org', userId: 'user' });
  const html = renderToStaticMarkup(tree);
  const dialog = html.match(/<div[^>]*role="dialog"[^>]*>/)[0];
  assert.match(dialog, /id="workspace-navigation"/);
  assert.match(dialog, /aria-label="Workspace navigation"/);
  assert.match(html, /nav-close/);
  assert.match(html, /mobile-nav-backdrop/);

  const oldDocument = globalThis.document,
    oldWindow = globalThis.window;
  let focused;
  const control = (name) => ({ getClientRects: () => [{}], focus: () => (focused = name) });
  const first = control('first'),
    last = control('last');
  globalThis.document = { getElementById: () => main, activeElement: last };
  globalThis.window = { matchMedia: () => media };
  try {
    const cleanup = effect();
    assert.equal(main.inert, true);
    // Safari can skip links natively, so the sheet cycles every visible control explicitly.
    const content = tree.props.children[1];
    let prevented = false;
    const tab = (shiftKey) =>
      content.props.onKeyDown({
        key: 'Tab',
        shiftKey,
        currentTarget: { querySelectorAll: () => [first, last] },
        preventDefault: () => (prevented = true),
      });
    tab(false);
    assert.equal(prevented, true);
    assert.equal(focused, 'first');
    globalThis.document.activeElement = first;
    tab(true);
    assert.equal(focused, 'last');
    cleanup();
    assert.equal(main.inert, false);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  }
});
test('bulk actions appear only for selected rows and clear selection restores row focus', () => {
  let count = 0,
    effect,
    handler,
    focused = false;
  const row = { checked: true, indeterminate: false, focus: () => (focused = true) };
  const form = {
    querySelectorAll: (selector) =>
      selector.includes(':checked') ? (row.checked ? [row] : []) : [row],
    querySelector: () => row,
    addEventListener: (_, fn) => (handler = fn),
    removeEventListener: () => {},
  };
  const { BulkActions } = load('src/features/tickets/bulk-actions.tsx', {
    react: {
      ...React,
      useState: () => [count, (n) => (count = n)],
      useEffect: (fn) => (effect = fn),
    },
  });
  globalThis.document = { getElementById: () => form };
  try {
    let tree = BulkActions({ formId: 'tickets', children: 'Controls' });
    assert.equal(tree.props.hidden, true);
    effect();
    tree = BulkActions({ formId: 'tickets', children: 'Controls' });
    assert.equal(tree.props.hidden, false);
    assert.match(renderToStaticMarkup(tree), /1 ticket selected/);
    tree.props.children[0].props.children[1].props.onClick();
    assert.equal(row.checked, false);
    assert.equal(count, 0);
    assert.equal(focused, true);
    handler();
    assert.equal(count, 0);
  } finally {
    delete globalThis.document;
  }
});
test('pending submit buttons prevent duplicate submission and announce progress', () => {
  const { SubmitButton } = load('src/components/ui/submit-button.tsx', {
    'react-dom': { useFormStatus: () => ({ pending: true }) },
    './form-pending': { FormPendingContext: React.createContext(false) },
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmitButton, { pendingLabel: 'Saving profile…' }, 'Save profile'),
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Saving profile/);
});
test('interactive blue and muted text meet normal-text contrast on white', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const luminance = (hex) => {
    const rgb = hex
      .match(/[0-9a-f]{2}/gi)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const name of ['accent', 'text-muted', 'text-subtle']) {
    const hex = css.match(new RegExp(`--color-${name}: (#\\w+);`))[1];
    assert.ok(1.05 / (luminance(hex) + 0.05) >= 4.5, `${name} contrast`);
  }
});

test('select all synchronizes row selection and notifies the bulk toolbar', () => {
  const rows = [{ checked: false }, { checked: false }];
  let notified = false;
  const { BulkSelectAll } = load('src/features/tickets/bulk-select-all.tsx', {
    react: { ...React, useRef: () => ({ current: null }), useEffect: () => {} },
  });
  globalThis.document = {
    querySelectorAll: () => rows,
    getElementById: () => ({
      dispatchEvent: (event) => {
        notified = event.type === 'change';
      },
    }),
  };
  try {
    BulkSelectAll({ formId: 'tickets' }).props.onChange({ currentTarget: { checked: true } });
    assert.ok(rows.every((row) => row.checked));
    assert.equal(notified, true);
  } finally {
    delete globalThis.document;
  }
});

test('every role can find chat creation and gets a labeled form with realistic response expectations', async () => {
  const builder = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) => Promise.resolve({ data: [], error: null }).then(resolve)
          : () => builder,
    },
  );
  for (const role of ['end_user', 'technician', 'administrator']) {
    const page = load('src/app/app/chat/page.tsx', {
      'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
      'next/link': { default: (props) => React.createElement('a', props) },
      '@/lib/auth/viewer': {
        requireViewer: async () => ({ role, id: 'user', organizationId: 'org' }),
      },
      '@/lib/supabase/server': { createClient: async () => ({ from: () => builder }) },
      '@/features/chat/live-queue': { LiveChatQueue: () => null },
      '@/features/tickets/presentation': { formatTicketDate: (v) => v },
      '@/components/ui/submit-button': {
        SubmitButton: (props) => {
          const buttonProps = { ...props };
          delete buttonProps.pendingLabel;
          return React.createElement('button', buttonProps);
        },
      },
      '@/app/app/chat/actions': { startChat: async () => {} },
    }).default;
    const list = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
    assert.match(list, /href="\/app\/chat\?start=1"/);
    for (const params of [{ start: '1' }, { error: 'Please try again.' }]) {
      const form = renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));
      assert.match(form, /<h1>Start a chat<\/h1>/);
      assert.match(form, /<label for="chat-topic">/);
      assert.match(form, /<label for="chat-first-message">/);
      assert.match(form, /Support hours:.*7 AM–10 PM, every day/i);
      assert.match(form, /href="\/app\/chat"/);
      if (params.error) assert.match(form, /role="alert"/);
    }
  }
});

test('desktop navigation does not move focus to the hidden mobile menu button', () => {
  let focused = false;
  const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
    ...navMocks,
    react: {
      ...React,
      useState: () => [false, () => {}],
      useRef: () => ({ current: { focus: () => (focused = true) } }),
      useEffect: () => {},
    },
  });
  const tree = WorkspaceNav({ role: 'technician', organizationId: 'org', userId: 'user' });
  // Closed state: the Sheet's second child is the in-place navigation panel.
  const panel = tree.props.children[1];
  const findLink = (node) => {
    if (!React.isValidElement(node)) return null;
    if (node.props.href && node.props.onClick) return node;
    for (const child of React.Children.toArray(node.props.children)) {
      const match = findLink(child);
      if (match) return match;
    }
    return null;
  };
  const firstLink = findLink(panel);
  assert.ok(firstLink);
  firstLink.props.onClick();
  assert.equal(focused, false);
});

test('input boundaries and focus contrast meet 3:1 on adjacent light surfaces', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const luminance = (hex) => {
    const rgb = hex
      .match(/[0-9a-f]{2}/gi)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const token = (name) => css.match(new RegExp(`--color-${name}: (#\\w+);`))[1];
  for (const surface of ['surface', 'canvas', 'surface-subtle']) {
    for (const foreground of ['control-border', 'focus']) {
      assert.ok(
        (luminance(token(surface)) + 0.05) / (luminance(token(foreground)) + 0.05) >= 3,
        `${foreground} on ${surface}`,
      );
    }
  }
});

test('overview charcoal header maintains readable text and visible keyboard focus', () => {
  const css = productStyles().replace(/\s+/g, ' ').replace(/'/g, '"');
  const luminance = (name) => {
    const hex = css.match(new RegExp(`--color-${name}: (#\\w+);`))[1];
    const rgb = hex
      .match(/[0-9a-f]{2}/gi)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const ink = luminance('brand-ink');
  for (const name of ['surface', 'border-strong', 'brand-text-muted'])
    assert.ok((luminance(name) + 0.05) / (ink + 0.05) >= 4.5, `${name} on charcoal`);
  assert.match(
    css,
    /\.overview-page > \.page-header \.button-primary:focus-visible \{ outline-color: var\(--color-brand-secondary\); \}/,
  );
});
