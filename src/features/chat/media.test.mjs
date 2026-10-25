import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { validChatAttachment, chatMediaKind } = load('src/features/chat/media.ts');

test('chat media accepts supported photo, video and audio types within the existing size limit', () => {
  for (const type of [
    'image/png',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'application/pdf',
  ]) {
    assert.equal(validChatAttachment({ type, size: 10 * 1024 * 1024 }), true);
    assert.equal(validChatAttachment({ type, size: 0 }), false);
    assert.equal(validChatAttachment({ type, size: 10 * 1024 * 1024 + 1 }), false);
  }
  for (const type of ['text/html', 'image/svg+xml', 'application/javascript', 'video/unknown', ''])
    assert.equal(validChatAttachment({ type, size: 1 }), false);
  assert.equal(chatMediaKind('image/svg+xml'), 'file');
});

test('private media provides accessible native controls, no autoplay and direct fallback links', () => {
  const { ChatMediaAttachment } = load('src/features/chat/media-attachment.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
  });
  for (const [type, tag] of [
    ['image/png', 'img'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(ChatMediaAttachment, {
        file: {
          file_name: 'sample',
          content_type: type,
          size_bytes: 1024,
          url: 'https://example.test/private-signed',
        },
      }),
    );
    assert.match(html, new RegExp(`<${tag}`));
    assert.match(html, /href="https:\/\/example.test\/private-signed"/);
    if (tag === 'img') assert.match(html, /alt="sample"/);
    else {
      assert.match(html, /controls=""/);
      assert.match(html, /aria-label="(?:Video|Audio): sample"/);
    }
    assert.doesNotMatch(html, /autoplay|autoPlay|<iframe|<script/);
  }
  const unavailable = renderToStaticMarkup(
    React.createElement(ChatMediaAttachment, {
      file: { file_name: 'expired.mp4', content_type: 'video/mp4', size_bytes: 1024 },
    }),
  );
  assert.match(unavailable, /Media unavailable/);
  assert.match(unavailable, /Try again/);
  assert.doesNotMatch(unavailable, /<video/);
});
