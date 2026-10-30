import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { createdTicketId, withUploadNote } = load('src/features/tickets/new-ticket-form.tsx', {
  './attachment-upload': { uploadTicketAttachment: async () => 'saved' },
});

test('initial files attach to the ticket named in the creation redirect', () => {
  assert.equal(createdTicketId('/app/tickets/abc-123?success=Request sent.'), 'abc-123');
  assert.equal(createdTicketId('/app/tickets/new?error=x'), null);
  assert.equal(createdTicketId('/app/chat/abc'), null);
});

test('failed initial uploads are reported on the request page without hiding the success', () => {
  assert.equal(
    withUploadNote('/app/tickets/a?success=Request sent.', []),
    '/app/tickets/a?success=Request sent.',
  );
  const one = new URL(
    withUploadNote('/app/tickets/a?success=Request sent.', ['shot.png']),
    'https://x',
  );
  assert.equal(
    one.searchParams.get('success'),
    'Request sent. shot.png could not be attached. Add it again below.',
  );
  const two = new URL(
    withUploadNote('/app/tickets/a?success=Request sent.', ['a.pdf', 'b.png']),
    'https://x',
  );
  assert.match(two.searchParams.get('success'), /2 files could not be attached \(a\.pdf, b\.png\)/);
});

test('creation shows file-by-file progress, continues after failures and opens the created request', async () => {
  const calls = [],
    releases = [];
  const h = componentHarness(
    'src/features/tickets/new-ticket-form.tsx',
    'NewTicketForm',
    {
      action: async () => ({}),
      organizationId: 'org',
      userId: 'user',
      children: 'Form fields',
    },
    {
      './attachment-upload': {
        uploadTicketAttachment: (args) => {
          calls.push(args);
          return new Promise((resolve, reject) => releases.push({ resolve, reject }));
        },
      },
    },
  );
  try {
    h.find((n) => n.props.value?.setFiles).props.value.setFiles([
      { name: 'one.png' },
      { name: 'two.pdf' },
    ]);
    h.render();
    const form = () => h.find((n) => typeof n.props.beforeRedirect === 'function');
    assert.equal(form().props.pendingMessage, null);
    const uploading = form().props.beforeRedirect('/app/tickets/created?success=Request sent.');
    h.render();
    assert.equal(form().props.pendingMessage, 'Request created. Uploading file 1 of 2…');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ticketId, 'created');
    releases[0].reject(new Error('Connection interrupted'));
    await Promise.resolve();
    await Promise.resolve();
    h.render();
    assert.equal(form().props.pendingMessage, 'Request created. Uploading file 2 of 2…');
    assert.equal(calls.length, 2);
    releases[1].resolve('saved');
    const target = await uploading;
    h.render();
    assert.equal(form().props.pendingMessage, 'Opening request…');
    assert.match(
      new URL(target, 'https://x').searchParams.get('success'),
      /one.png could not be attached/,
    );
    assert.equal(h.find((n) => n.props.value?.files).props.value.files.length, 2);
  } finally {
    h.close();
  }
});

test('creation without files never claims an upload is in progress', async () => {
  const h = componentHarness('src/features/tickets/new-ticket-form.tsx', 'NewTicketForm', {
    action: async () => ({}),
    organizationId: 'org',
    userId: 'user',
    children: 'Fields',
  });
  try {
    const form = h.find((n) => typeof n.props.beforeRedirect === 'function');
    assert.equal(await form.props.beforeRedirect('/app/tickets/created'), undefined);
    h.render();
    assert.equal(
      h.find((n) => typeof n.props.beforeRedirect === 'function').props.pendingMessage,
      null,
    );
  } finally {
    h.close();
  }
});
