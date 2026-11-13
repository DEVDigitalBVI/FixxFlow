import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { AssetStatusBadge } = load('src/features/assets/asset-status-badge.tsx');
test('assigned equipment never presents an unqualified Available label', () => {
  const html = render(
    React.createElement(AssetStatusBadge, { status: 'available', assigned: true }),
  );
  assert.match(html, /Assigned · Review availability/);
  assert.doesNotMatch(html, />Available</);
  assert.match(render(React.createElement(AssetStatusBadge, { status: 'available' })), /Available/);
  assert.match(
    render(React.createElement(AssetStatusBadge, { status: 'repair', assigned: true })),
    /Under repair/,
  );
});

test('workspace keeps request and reply visible with native secondary disclosures', () => {
  const { TicketWorkspace } = load('src/features/tickets/ticket-workspace.tsx');
  const html = render(
    React.createElement(TicketWorkspace, {
      review: 'Request draft',
      assignment: 'Status controls',
      conversation: 'Reply draft',
      resolution: 'SLA',
      tools: 'Coordination draft',
      activeWorkflow: true,
      history: 'Recorded history',
      files: 'Files',
    }),
  );
  assert.doesNotMatch(html, /hidden=""|ticket-wizard|Show guidance/);
  assert.match(html, /Request draft/);
  assert.match(html, /Reply draft/);
  assert.match(html, /id="ticket-workflow-tools" open=""/);
  assert.match(html, /<summary>Activity<\/summary>/);
});

test('article contents are available as a named collapsed disclosure before readable content', () => {
  const { ArticleContent } = load('src/features/knowledge/article-content.tsx');
  const html = render(
    React.createElement(ArticleContent, {
      showContents: true,
      content: [
        { type: 'heading', text: 'First step' },
        { type: 'paragraph', text: 'Useful answer' },
        { type: 'heading', text: 'Second step' },
      ],
    }),
  );
  assert.match(html, /<details class="knowledge-contents"><summary>On this page/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /href="#article-section-0"/);
  assert.match(html, /Useful answer/);
});

test('copy address confirms success and explains clipboard failure without losing the address', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  let fail = false;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          if (fail) throw Error('Denied');
          copied.push(text);
        },
      },
    },
  });
  const h = componentHarness('src/components/ui/copy-text-button.tsx', 'CopyTextButton', {
    text: 'it@example.invalid',
  });
  try {
    await h.find((n) => n.type === 'button').props.onClick();
    h.render();
    assert.deepEqual(copied, ['it@example.invalid']);
    assert.equal(h.find((n) => n.props.role === 'status').props.children, 'Copied.');
    fail = true;
    await h.find((n) => n.type === 'button').props.onClick();
    h.render();
    assert.match(
      h.find((n) => n.props.role === 'status').props.children,
      /Select and copy the address above/,
    );
  } finally {
    h.close();
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('empty incident reports explain absence instead of presenting empty detail controls', async () => {
  const { IncidentReport } = load('src/features/reporting/incident-report.tsx', {
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async () => ({
          data: {
            summary: { total: 0, open: 0 },
            items: [],
            breakdowns: [],
          },
          error: null,
        }),
      }),
    },
  });
  const html = render(await IncidentReport({ organizationId: 'org' }));
  assert.match(html, /No incidents declared/);
  assert.doesNotMatch(html, /Incident details|Avg. service downtime/);
  assert.match(html, /id="incident-report"/);
});

test('omitting a repeated introduction preserves existing article section anchors', () => {
  const { ArticleContent } = load('src/features/knowledge/article-content.tsx');
  const html = render(
    React.createElement(ArticleContent, {
      openingSummary: 'Repeated summary',
      showContents: true,
      content: [
        { type: 'paragraph', text: 'Repeated summary' },
        { type: 'heading', text: 'First step' },
        { type: 'paragraph', text: 'The answer' },
        { type: 'heading', text: 'Next step' },
      ],
    }),
  );
  assert.doesNotMatch(html, /Repeated summary/);
  assert.match(html, /id="article-section-1"/);
  assert.match(html, /href="#article-section-3"/);
});

test('category overlap warnings ignore retired choices but retain genuine active ambiguity', () => {
  const { hasOverlappingActiveNames } = load('src/features/administration/classification-names.ts');
  const rows = [
    { name: 'Account / Access', is_active: true },
    { name: 'Access', is_active: false },
    { name: 'Hardware', is_active: true },
    { name: 'Computer', is_active: false },
  ];
  assert.equal(hasOverlappingActiveNames(rows), false);
  assert.equal(hasOverlappingActiveNames(rows.map((row) => ({ ...row, is_active: true }))), true);
  assert.equal(
    hasOverlappingActiveNames([
      { name: 'Network / Printer', is_active: true },
      { name: 'PRINTER', is_active: true },
    ]),
    true,
  );
  assert.equal(hasOverlappingActiveNames([{ name: 'Access', is_active: true }]), false);
});

test('article introductions omit the repeated summary while preserving additional guidance and anchors', () => {
  const { ArticleContent } = load('src/features/knowledge/article-content.tsx');
  const html = render(
    React.createElement(ArticleContent, {
      openingSummary: 'Find the correct settings.',
      showContents: true,
      content: [
        {
          type: 'paragraph',
          text: 'Find the correct settings. Available controls depend on your role.',
        },
        { type: 'heading', text: 'Open settings' },
        { type: 'heading', text: 'Review access' },
      ],
    }),
  );
  assert.doesNotMatch(html, /Find the correct settings/);
  assert.match(html, /Available controls depend on your role/);
  assert.match(html, /href="#article-section-1"/);
  assert.match(html, /id="article-section-1"/);
});
