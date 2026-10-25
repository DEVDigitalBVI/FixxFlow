import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { conditionResults } = load('src/features/automation/execution-records.ts');

test('stored condition results keep well-formed entries and never throw on bad JSON', () => {
  const passed = { id: 'c1', field: 'priority', operator: 'equals', status: 'passed' };
  const failed = {
    id: 'c2',
    field: 'status',
    operator: 'in',
    status: 'failed',
    error: { code: 'x' },
  };
  assert.deepEqual(conditionResults([passed, failed]), [passed, failed]);
  assert.deepEqual(
    conditionResults([
      passed,
      null,
      'text',
      { id: 'c3', status: 'passed' },
      { ...passed, status: 'maybe' },
    ]),
    [passed],
  );
  for (const value of [null, undefined, {}, 'conditions', 3])
    assert.deepEqual(conditionResults(value), []);
});
