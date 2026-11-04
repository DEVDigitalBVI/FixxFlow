import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const member = (n) => ({
  user_id: `member-${n}`,
  display_name: `Member ${n}`,
  email: `member${n}@example.invalid`,
});
test('specific-member selection survives pagination, search failures and switching to all', async () => {
  const old = globalThis.fetch;
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    const params = new URL(url, 'https://fixture.invalid').searchParams;
    calls.push({ params, options });
    return fail
      ? Response.json({}, { status: 503 })
      : Response.json({ rows: [member(2)], total: 51 });
  };
  const ui = componentHarness(
    'src/features/email-announcements/audience.tsx',
    'AnnouncementAudience',
    { choices: { rows: [member(1)], total: 51 } },
  );
  try {
    ui.find((n) => n.props.name === 'audience' && n.props.value === 'selected').props.onChange();
    ui.render();
    ui.find((n) => n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    ui.render();
    ui.find((n) => n.type === 'button' && n.props.children === 'More members').props.onClick();
    ui.render();
    await pause(20);
    ui.render();
    assert.equal(calls[0].params.get('page'), '2');
    ui.find((n) => n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    ui.render();
    assert.deepEqual(
      ui
        .all((n) => n.props.name === 'memberIds')
        .map((n) => n.props.value)
        .sort(),
      ['member-1', 'member-2'],
    );
    fail = true;
    ui.find((n) => n.props.type === 'search').props.onChange({
      target: { value: 'member' },
      stopPropagation() {},
    });
    ui.render();
    await pause(330);
    ui.render();
    assert.ok(ui.all((n) => n.type === 'button' && n.props.children === 'Try again').length);
    assert.equal(ui.all((n) => n.props.name === 'memberIds').length, 2);
    fail = false;
    ui.find((n) => n.type === 'button' && n.props.children === 'Try again').props.onClick();
    ui.render();
    await pause(330);
    ui.render();
    assert.equal(ui.all((n) => n.type === 'button' && n.props.children === 'Try again').length, 0);
    ui.find((n) => n.props.name === 'audience' && n.props.value === 'all').props.onChange();
    ui.render();
    assert.equal(ui.all((n) => n.props.name === 'memberIds').length, 0);
    ui.find((n) => n.props.name === 'audience' && n.props.value === 'selected').props.onChange();
    ui.render();
    assert.equal(ui.all((n) => n.props.name === 'memberIds').length, 2);
    assert.ok(calls.every((c) => c.options.cache === 'no-store' && c.options.redirect === 'error'));
  } finally {
    ui.close();
    globalThis.fetch = old;
  }
});
