import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { parseHold } = load('src/features/tickets/holds.ts');
function form(changes = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    holdReason: 'vendor',
    holdNote: 'Replacement scheduled',
    holdReviewAt: '2026-11-10T09:00',
    holdReviewTimezone: 'America/Tortola',
    ...changes,
  }))
    data.set(key, value);
  return data;
}
test('holds validate reason, explanation, timezone and future follow-up', () => {
  const now = Date.parse('2026-11-09T12:00Z');
  assert.deepEqual(parseHold(form(), now).values, {
    hold_reason: 'vendor',
    hold_note: 'Replacement scheduled',
    hold_review_at: '2026-11-10T13:00:00.000Z',
  });
  for (const change of [
    { holdReason: 'invented' },
    { holdNote: '   ' },
    { holdNote: 'x'.repeat(2001) },
    { holdReviewAt: '' },
    { holdReviewAt: '2026-02-30T09:00' },
    { holdReviewAt: '2026-11-08T09:00' },
    { holdReviewTimezone: 'invalid' },
  ])
    assert.ok(parseHold(form(change), now).error);
});
test('ambiguous follow-up dates require an explicit DST occurrence', () => {
  const now = Date.parse('2026-10-31T12:00Z');
  assert.ok(
    parseHold(
      form({ holdReviewAt: '2026-11-01T01:30', holdReviewTimezone: 'America/New_York' }),
      now,
    ).error,
  );
  assert.equal(
    parseHold(
      form({
        holdReviewAt: '2026-11-01T01:30',
        holdReviewTimezone: 'America/New_York',
        holdReviewOccurrence: 'later',
      }),
      now,
    ).values.hold_review_at,
    '2026-11-01T06:30:00.000Z',
  );
});
