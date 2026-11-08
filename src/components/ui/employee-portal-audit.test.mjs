import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const mocks = { 'next/link': { default: (props) => React.createElement('a', props) } };
test('first chat shows the actionable inbox without an impossible selection prompt', () => {
  const { ChatCenter } = load('src/features/chat/chat-center.tsx', mocks);
  const html = render(
    React.createElement(ChatCenter, { personal: true, empty: true, inbox: 'Start a chat with IT' }),
  );
  assert.match(html, /chat-center-empty/);
  assert.match(html, /Start a chat with IT/);
  assert.doesNotMatch(html, /Select a conversation/);
  const populated = render(
    React.createElement(ChatCenter, { personal: true, inbox: 'Existing conversations' }),
  );
  assert.match(populated, /Select a conversation/);
  const selected = render(
    React.createElement(
      ChatCenter,
      {
        personal: true,
        empty: true,
        inbox: 'Inbox',
      },
      'Selected conversation',
    ),
  );
  assert.match(selected, /chat-center-selected/);
  assert.match(selected, /Selected conversation/);
});
test('employee help navigation uses the same label as the portal menu', () => {
  const { HelpNavigation } = load('src/features/knowledge/help-navigation.tsx', mocks);
  const personal = render(
    React.createElement(HelpNavigation, { personal: true, current: 'knowledge' }),
  );
  assert.match(personal, /aria-current="page">Help articles/);
  assert.doesNotMatch(personal, /Knowledge base/);
  assert.match(
    render(React.createElement(HelpNavigation, { current: 'knowledge' })),
    /Knowledge base/,
  );
});
test('workplace IT support is the first and primary contact path', () => {
  const Page = load('src/app/app/support/page.tsx', mocks).default;
  const html = render(React.createElement(Page));
  assert.ok(html.indexOf('Workplace IT help') < html.indexOf('Email FixxFlow support'));
  assert.match(html, /href="\/app\/tickets\/new"/);
  assert.match(html, /mailto:support@fixxflow.app/);
  assert.match(html, /Email app didn’t open/);
});
