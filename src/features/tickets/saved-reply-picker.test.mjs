import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const replies = [
  { id: 'r1', title: 'Password reset', body: 'Hi {{requester_first_name}}, reset at the portal.' },
  {
    id: 'r2',
    title: 'Need more details',
    body: 'Could you send a screenshot of {{ticket_number}}?',
  },
];
const composerMocks = {
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  '@/components/ui/unsaved-changes': { useUnsavedChanges() {} },
};
const text = (node) =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join('')
      : node?.props
        ? text(node.props.children)
        : '';

test('staff composers offer saved replies; employee composers never do', () => {
  globalThis.requestAnimationFrame = (callback) => callback();
  const staff = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    {
      ticketId: 't1',
      action: async () => ({}),
      savedReplies: replies,
      replyContext: { requesterName: 'Jordan Morgan', ticketNumber: 1042 },
    },
    composerMocks,
  );
  try {
    const picker = staff.find((node) => Array.isArray(node.props?.replies));
    assert.deepEqual(picker.props.context, { requesterName: 'Jordan Morgan', ticketNumber: 1042 });
    staff
      .find((node) => node.props?.id === 'message-body')
      .props.onChange({
        target: { value: 'Thanks for the update.' },
      });
    staff.render();
    staff
      .find((node) => Array.isArray(node.props?.replies))
      .props.onInsert('Hi Jordan, reset at the portal.');
    staff.render();
    assert.equal(
      staff.find((node) => node.props?.id === 'message-body').props.value,
      'Thanks for the update.\nHi Jordan, reset at the portal.',
      'the reply is added to the draft for review, not sent',
    );
  } finally {
    staff.close();
  }

  const employee = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    { ticketId: 't1', action: async () => ({}), staff: false, savedReplies: replies },
    composerMocks,
  );
  try {
    assert.equal(employee.all((node) => Array.isArray(node.props?.replies)).length, 0);
  } finally {
    employee.close();
  }
});

test('the picker filters by title or text and inserts the filled-in reply', () => {
  const inserted = [];
  const picker = componentHarness(
    'src/features/tickets/saved-reply-picker.tsx',
    'SavedReplyPicker',
    {
      replies,
      context: { requesterName: 'Jordan Morgan', ticketNumber: 1042 },
      onInsert: (value) => inserted.push(value),
    },
    { 'next/link': { default: (props) => props } },
  );
  try {
    const options = () => picker.all((node) => node.type === 'button');
    assert.equal(options().length, 2);
    picker
      .find((node) => node.props?.type === 'search')
      .props.onChange({
        target: { value: 'SCREENSHOT' },
      });
    picker.render();
    assert.deepEqual(
      options().map((node) => text(node.props.children[0])),
      ['Need more details'],
    );
    options()[0].props.onClick();
    assert.deepEqual(inserted, ['Could you send a screenshot of #1042?']);
    picker.render();
    assert.equal(
      picker.find((node) => node.props?.type === 'search').props.value,
      '',
      'the search resets after inserting',
    );
    assert.ok(
      picker.find((node) => node.props?.href === '/app/administration/saved-replies'),
      'staff can reach the management page from the picker',
    );
  } finally {
    picker.close();
  }
});
