import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { renderSavedReply, insertIntoDraft, validateSavedReply, SAVED_REPLY_BODY_LIMIT } = load(
  'src/features/tickets/saved-replies.ts',
);

test('saved replies fill known placeholders and keep unknown or missing ones visible', () => {
  const body =
    'Hi {{requester_first_name}}, about {{ticket_number}}: {{ unknown_field }}. — {{agent_first_name}} ({{agent_name}})';
  assert.equal(
    renderSavedReply(body, {
      requesterName: '  Jordan  Morgan ',
      agentName: 'Casey Robinson',
      ticketNumber: 1042,
    }),
    'Hi Jordan, about #1042: {{ unknown_field }}. — Casey (Casey Robinson)',
  );
  // Chat has no ticket number: the placeholder stays for staff to edit before sending.
  assert.equal(
    renderSavedReply('Ticket {{ticket_number}} for {{requester_name}}', { requesterName: 'Sam' }),
    'Ticket {{ticket_number}} for Sam',
  );
  assert.equal(
    renderSavedReply('{{requester_first_name}}', { requesterName: '' }),
    '{{requester_first_name}}',
  );
});

test('inserting a saved reply respects the caret and separates it from existing text', () => {
  assert.deepEqual(insertIntoDraft('', 'Reply', 0, 0), { value: 'Reply', caret: 5 });
  assert.deepEqual(insertIntoDraft('Hello', 'Reply', 5, 5), { value: 'Hello\nReply', caret: 11 });
  assert.deepEqual(insertIntoDraft('Hello\nBye', 'Reply', 6, 6), {
    value: 'Hello\nReply\nBye',
    caret: 11,
  });
  // A selection is replaced.
  assert.deepEqual(insertIntoDraft('Hello OLD there', 'NEW', 6, 9), {
    value: 'Hello \nNEW\n there',
    caret: 10,
  });
});

test('saved reply validation bounds the title and text', () => {
  assert.equal(validateSavedReply('Password reset', 'Steps'), null);
  assert.match(validateSavedReply(' x ', 'Steps'), /title/);
  assert.match(validateSavedReply('x'.repeat(121), 'Steps'), /title/);
  assert.match(validateSavedReply('Valid title', '   '), /reply text/);
  assert.match(
    validateSavedReply('Valid title', 'x'.repeat(SAVED_REPLY_BODY_LIMIT + 1)),
    /reply text/,
  );
});
