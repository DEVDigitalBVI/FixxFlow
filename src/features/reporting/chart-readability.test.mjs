import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { Trend, Bars } = load('src/features/reporting/components.tsx', {
  'next/link': { default: (props) => React.createElement('a', props) },
});
const { chartScale, elapsedLabel } = load('src/features/reporting/chart-model.ts');
test('sparse timing data displays dated values, missing-day explanation and true zero bars', () => {
  const html = render(
    React.createElement(Trend, {
      title: 'Response time',
      description: 'Reply times',
      days: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'],
      series: [{ label: 'Average response', values: [null, 0, null, 582] }],
      time: true,
    }),
  );
  assert.match(html, /2 of 4 days have timing data/);
  assert.match(html, /not counted as zero/);
  assert.match(html, /Nov 2/);
  assert.match(html, /Nov 4/);
  assert.match(html, />0m</);
  assert.match(html, />9h 42m</);
  assert.match(html, /width:0%/);
  assert.doesNotMatch(html, /<svg|<circle/);
  assert.match(html, /scope="row">2026-11-01/);
  assert.match(html, /No data/);
});
test('dense timing data has readable HTML scale and gridlines and never bridges missing days', () => {
  const values = [30, 60, null, 120, 180, 300, 582];
  const days = values.map((_, i) => `2026-11-0${i + 1}`);
  const html = render(
    React.createElement(Trend, {
      title: 'Response time',
      description: 'Reply times',
      days,
      series: [{ label: 'Average response', values }],
      time: true,
    }),
  );
  assert.match(html, /report-y-axis/);
  assert.match(html, /report-grid-line/);
  assert.match(html, /12h/);
  assert.match(html, /Elapsed time/);
  assert.equal((html.match(/<circle/g) ?? []).length, 6);
  assert.equal(
    (html.match(/vector-effect="non-scaling-stroke"/g) ?? []).length,
    9,
    'five grid lines and four adjacent sample connections',
  );
  assert.match(html, /Vertical axis ranges from 0 minutes to 12h/);
  assert.equal(elapsedLabel(582), '9h 42m');
  assert.deepEqual(chartScale(582, true), { max: 720, ticks: [720, 540, 360, 180, 0] });
});

test('bar scales preserve count, percent and elapsed-time units', () => {
  for (const [props, unit, value] of [
    [{}, 'tickets', '90'],
    [{ percent: true }, 'percent', '90.0%'],
    [{ time: true }, 'minutes', '1h 30m'],
  ]) {
    const html = render(
      React.createElement(Bars, {
        title: 'Breakdown',
        description: 'Measured values',
        rows: [{ label: 'Support', value: 90 }],
        ...props,
      }),
    );
    assert.match(html, new RegExp(`${unit} · each chart has its own scale`));
    assert.ok(html.includes(`<strong>${value}</strong>`));
    assert.match(html, /width:/);
  }
});
