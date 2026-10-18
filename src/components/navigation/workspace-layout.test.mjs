import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

test('employees and administrators use the same shell, brand and account controls', async () => {
  for (const role of ['end_user', 'administrator']) {
    const { default: Layout } = load('src/app/app/layout.tsx', {
      '@/lib/auth/viewer': { requireViewer: async () => ({ role, id: 'viewer', organizationId: 'org', organizationName: 'Example workspace', displayName: 'Jordan Morgan', timeZone: 'America/Tortola', timezonePreference: 'organization' }) },
      '@/features/inventory/access': { inventoryAccess: async () => ({ manager: false, departments: [] }) },
      '@/app/(auth)/actions': { signOut: async () => {} },
      '@/features/timezones/provider': { TimezoneProvider: ({ children }) => children },
      '@/features/identity/viewer-avatar': { ViewerAvatar: () => React.createElement('span', null, 'Avatar') },
      '@/components/navigation/workspace-nav': { WorkspaceNav: props => React.createElement('nav', { 'data-role': props.role, 'data-inventory': props.inventoryAccess }) },
      'next/image': { default: ({ src, alt, className, width, height }) => React.createElement('img', { src, alt, className, width, height }) },
      'next/link': { default: props => React.createElement('a', props) },
    });
    const html = renderToStaticMarkup(await Layout({ children: React.createElement('h1', null, 'Page content') }));
    assert.match(html, /class="app-shell"/);
    assert.match(html, /class="sidebar-logo|brand-logo-navigation sidebar-logo/);
    assert.match(html, /FixxFlow home/);
    assert.doesNotMatch(html, /sidebar-workspace|Example workspace/);
    assert.match(html, /class="sidebar-account"/);
    assert.match(html, /Jordan Morgan/);
    assert.match(html, /aria-label="Sign out"/);
    assert.match(html, new RegExp(`data-role="${role}"`));
    assert.match(html, /data-inventory="false"/);
    assert.match(html, role === 'end_user' ? /class="workspace employee-workspace"/ : /class="workspace"/);
    assert.match(html, /<h1>Page content<\/h1>/);
    assert.doesNotMatch(html, /portal-header|portal-shell/);
  }
});
