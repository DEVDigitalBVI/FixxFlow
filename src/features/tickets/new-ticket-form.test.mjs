import assert from 'node:assert/strict';
import test from 'node:test';

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
