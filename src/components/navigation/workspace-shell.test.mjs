import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

test('workspace shell defaults to the viewport and supports deliberate expansion and collapse', () => {
  for (const medium of [false, true]) {
    let state = null,
      effect,
      resize,
      removed = false;
    const media = {
      matches: medium,
      addEventListener: (_, listener) => {
        resize = listener;
      },
      removeEventListener: (_, listener) => {
        removed = listener === resize;
      },
    };
    const previous = globalThis.window;
    globalThis.window = { matchMedia: () => media };
    try {
      const { WorkspaceShell } = load('src/components/navigation/workspace-shell.tsx', {
        'next/navigation': { usePathname: () => '/app/profile' },
        react: {
          ...React,
          useState: () => [
            state,
            (value) => {
              state = typeof value === 'function' ? value(state) : value;
            },
          ],
          useEffect: (callback) => {
            effect = callback;
          },
        },
      });
      const render = () =>
        WorkspaceShell({
          brand: 'Brand',
          navigation: 'Navigation',
          account: 'Account',
          children: 'Content',
        });
      const button = (tree) => tree.props.children[0].props.children[0].props.children[1];
      assert.equal(render().props['data-sidebar'], 'auto');
      const cleanup = effect();
      let tree = render();
      assert.equal(tree.props['data-sidebar'], medium ? 'collapsed' : 'expanded');
      assert.equal(button(tree).props['aria-expanded'], !medium);
      button(tree).props.onClick();
      tree = render();
      assert.equal(tree.props['data-sidebar'], medium ? 'expanded' : 'collapsed');
      assert.equal(
        button(tree).props['aria-label'],
        medium ? 'Collapse sidebar' : 'Expand sidebar',
      );
      button(tree).props.onClick();
      assert.equal(state, medium);
      media.matches = !medium;
      resize();
      assert.equal(state, !medium);
      const html = renderToStaticMarkup(render());
      assert.match(html, /aria-label="Workspace sidebar"/);
      assert.match(html, /aria-controls="workspace-navigation"/);
      assert.doesNotMatch(html, /sidebar-workspace/);
      assert.match(
        html,
        /<main class="workspace" id="main-content" data-page-flow="standard">Content<\/main>/,
      );
      cleanup();
      assert.equal(removed, true);
    } finally {
      globalThis.window = previous;
    }
  }
});

test('shared page refinements exclude chat inbox, conversations, and history routes', () => {
  for (const pathname of [
    '/app',
    '/app/tickets',
    '/app/profile',
    '/platform/customers',
    '/app/chat',
    '/app/chat/conversation',
    '/app/chat/conversation/history',
  ]) {
    const { WorkspaceShell } = load('src/components/navigation/workspace-shell.tsx', {
      'next/navigation': { usePathname: () => pathname },
    });
    const html = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        { brand: 'Brand', navigation: 'Navigation', account: 'Account' },
        'Content',
      ),
    );
    assert.equal(html.includes('data-page-flow="standard"'), !pathname.startsWith('/app/chat'));
  }
});
