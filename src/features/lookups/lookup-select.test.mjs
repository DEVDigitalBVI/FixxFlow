import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const choice = (id, label = id) => ({ id, label, active: true, parent_id: null });

test('choosing a loaded option avoids refetching while parent changes still reload', async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url, 'https://fixture.test').searchParams);
    return Response.json({ rows: [choice('first'), choice('second')], selected: null, next: null });
  };
  const props = {
    resource: 'subcategories',
    name: 'subcategoryId',
    label: 'Subcategory',
    parentId: 'parent-a',
  };
  const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', props);
  try {
    await pause(20);
    ui.render();
    assert.equal(calls.length, 1);
    for (const value of ['first', 'second', '']) {
      ui.find((n) => n.type === 'select').props.onChange({ target: { value } });
      ui.render();
      await pause(20);
      ui.render();
      assert.equal(ui.find((n) => n.type === 'select').props.value, value);
      assert.equal(ui.all((n) => n.props.name === 'lookupLoadError').length, 0);
      assert.equal(calls.length, 1);
    }
    props.parentId = 'parent-b';
    ui.render();
    await pause(20);
    ui.render();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].get('parent'), 'parent-b');
  } finally {
    ui.close();
    globalThis.fetch = old;
  }
});

test('lookup retains selected values across pages/search, cancels stale requests, and recovers from failure', async () => {
  const old = globalThis.fetch;
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    const params = new URL(url, 'https://fixture.test').searchParams;
    calls.push({ params, options });
    if (fail) return Response.json({}, { status: 503 });
    return Response.json({
      rows: [choice(params.get('cursor') ? 'second' : 'first')],
      selected: choice('chosen'),
      next: params.get('cursor') ? null : 'next-page',
    });
  };
  const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
    resource: 'people',
    name: 'requesterId',
    label: 'Requester',
    defaultValue: 'chosen',
  });
  try {
    await pause(10);
    ui.render();
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'chosen');
    assert.ok(ui.all((n) => n.type === 'option').some((n) => n.props.value === 'chosen'));
    ui.find((n) => n.type === 'button' && n.props.children === 'More choices').props.onClick();
    ui.render();
    await pause(10);
    ui.render();
    assert.equal(calls.at(-1).params.get('cursor'), 'next-page');
    assert.equal(calls.at(-1).params.get('selected'), 'chosen');
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'chosen');
    const search = ui.find((n) => n.type === 'input' && n.props.type === 'search');
    search.props.onChange({ target: { value: 'new' }, stopPropagation() {} });
    ui.render();
    search.props.onChange({ target: { value: 'newest' }, stopPropagation() {} });
    ui.render();
    await pause(330);
    ui.render();
    assert.equal(calls.at(-1).params.get('cursor'), '');
    assert.equal(calls.at(-1).params.get('q'), 'newest');
    assert.ok(!calls.some((call) => call.params.get('q') === 'new'));
    fail = true;
    ui.find((n) => n.type === 'button' && n.props.children === 'More choices').props.onClick();
    ui.render();
    await pause(330);
    ui.render();
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'chosen');
    assert.equal(ui.find((n) => n.props.name === 'lookupLoadError').props.value, 'true');
    assert.match(ui.find((n) => n.props.role === 'status').props.children, /preserved/);
    fail = false;
    ui.find((n) => n.type === 'button' && n.props.children === 'Try again').props.onClick();
    ui.render();
    await pause(330);
    ui.render();
    assert.equal(ui.all((n) => n.props.name === 'lookupLoadError').length, 0);
  } finally {
    ui.close();
    globalThis.fetch = old;
  }
  assert.ok(
    calls.every((call) => call.options.cache === 'no-store' && call.options.redirect === 'error'),
  );
});

test('optional selection guard permits empty failed lookups but protects a chosen value', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  try {
    for (const selected of ['', 'chosen']) {
      const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
        resource: 'locations',
        name: 'locationId',
        label: 'Location',
        defaultValue: selected,
        guardSave: 'selection',
      });
      try {
        assert.equal(ui.all((n) => n.props.name === 'lookupLoadError').length, selected ? 1 : 0);
        await pause(20);
        ui.render();
        assert.equal(ui.all((n) => n.props.name === 'lookupLoadError').length, selected ? 1 : 0);
        assert.match(ui.find((n) => n.props.role === 'status').props.children, /could not load/);
      } finally {
        ui.close();
      }
    }
  } finally {
    globalThis.fetch = old;
  }
});

test('adaptive search keeps small dropdowns simple and stays available while filtering paginated choices', async () => {
  const old = globalThis.fetch;
  let large = false;
  globalThis.fetch = async (url) => {
    const params = new URL(url, 'https://fixture.test').searchParams;
    return Response.json({
      rows: [choice('first')],
      selected: null,
      next: large && !params.get('q') && !params.get('cursor') ? 'next-page' : null,
    });
  };
  try {
    const small = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
      resource: 'categories',
      name: 'categoryId',
      label: 'Category',
      searchable: 'when-paginated',
    });
    try {
      await pause(20);
      small.render();
      assert.equal(small.all((n) => n.props.type === 'search').length, 0);
      assert.equal(small.all((n) => n.type === 'button').length, 0);
      assert.equal(small.all((n) => n.type === 'select').length, 1);
    } finally {
      small.close();
    }
    large = true;
    const big = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
      resource: 'locations',
      name: 'locationId',
      label: 'Location',
      searchable: 'when-paginated',
    });
    try {
      assert.equal(big.all((n) => n.props.type === 'search').length, 0);
      await pause(20);
      big.render();
      const search = big.find((n) => n.props.type === 'search');
      assert.equal(
        big.find((n) => n.type === 'button' && n.props.children === 'More choices').props.disabled,
        false,
      );
      big.find((n) => n.type === 'button' && n.props.children === 'More choices').props.onClick();
      big.render();
      await pause(20);
      big.render();
      assert.equal(
        big.find((n) => n.type === 'button' && n.props.children === 'More choices').props.disabled,
        true,
      );
      assert.equal(big.all((n) => n.props.type === 'search').length, 1);
      search.props.onChange({ target: { value: 'first' }, stopPropagation() {} });
      big.render();
      await pause(330);
      big.render();
      assert.equal(big.find((n) => n.props.type === 'search').props.value, 'first');
      big.find((n) => n.type === 'button' && n.props.children === 'Clear search').props.onClick();
      big.render();
      assert.equal(big.all((n) => n.props.type === 'search').length, 1);
      await pause(20);
      big.render();
      assert.equal(big.all((n) => n.props.type === 'search').length, 1);
    } finally {
      big.close();
    }
  } finally {
    globalThis.fetch = old;
  }
});

test('adaptive dropdown failures offer retry and focus the select when search is absent', async () => {
  const old = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async () =>
    fail
      ? Response.json({}, { status: 503 })
      : Response.json({ rows: [], selected: null, next: null });
  const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
    resource: 'locations',
    name: 'locationId',
    label: 'Location',
    searchable: 'when-paginated',
    guardSave: 'selection',
  });
  try {
    await pause(20);
    ui.render();
    assert.equal(ui.all((n) => n.props.type === 'search').length, 0);
    assert.match(ui.find((n) => n.props.role === 'status').props.children, /could not load/);
    let focused = false;
    ui.find((n) => n.type === 'select').props.ref.current = {
      focus() {
        focused = true;
      },
    };
    fail = false;
    ui.find((n) => n.type === 'button' && n.props.children === 'Try again').props.onClick();
    ui.render();
    assert.equal(focused, true);
    await pause(20);
    ui.render();
    assert.equal(ui.find((n) => n.props.role === 'status').props.children, 'No choices available.');
    assert.equal(ui.all((n) => n.type === 'button').length, 0);
  } finally {
    ui.close();
    globalThis.fetch = old;
  }
});

test('loaded dropdowns omit choice counts across resources and display modes', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ rows: [choice('first'), choice('second')], selected: null, next: null });
  try {
    for (const resource of ['categories', 'locations', 'people'])
      for (const compact of [false, true]) {
        const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
          resource,
          name: 'selection',
          label: 'Selection',
          searchable: false,
          compact,
        });
        try {
          assert.equal(
            ui.find((n) => n.props.role === 'status').props.children,
            'Loading choices…',
          );
          await pause(20);
          ui.render();
          const status = ui.find((n) => n.props.role === 'status');
          assert.equal(status.props.children, '');
          assert.equal(status.props.className, 'sr-only');
          assert.ok(
            ui.find((n) => n.type === 'select').props['aria-describedby'].includes(status.props.id),
          );
          assert.equal(ui.all((n) => n.type === 'option').length, 3);
        } finally {
          ui.close();
        }
      }
  } finally {
    globalThis.fetch = old;
  }
});

test('new-ticket requester search moves to a match, permits explicit choice, and clears unmatched requesters', async () => {
  const old = globalThis.fetch;
  let fail = false;
  const changes = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url, 'https://fixture.test').searchParams;
    if (fail) return Response.json({}, { status: 503 });
    const rows =
      params.get('q') === 'Ishelle'
        ? [choice('ishelle', 'Ishelle'), choice('ishelle-other', 'Ishelle Other')]
        : params.get('q')
          ? []
          : [choice('jamaal', 'Jamaal')];
    return Response.json({ rows, selected: choice(params.get('selected'), 'Jamaal'), next: null });
  };
  const ui = componentHarness('src/features/lookups/lookup-select.tsx', 'LookupSelect', {
    resource: 'people',
    name: 'requesterId',
    label: 'Requester',
    defaultValue: 'jamaal',
    selectFirstMatchOnSearch: true,
    required: true,
    onChange: (id) => changes.push(id),
  });
  const search = async (text) => {
    ui.find((n) => n.props.type === 'search').props.onChange({
      target: { value: text },
      stopPropagation() {},
    });
    ui.render();
    assert.equal(ui.find((n) => n.props.name === 'lookupLoadError').props.value, 'true');
    await pause(text ? 330 : 20);
    ui.render();
    await pause(20);
    ui.render();
  };
  try {
    await pause(20);
    ui.render();
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'jamaal');
    await search('Ishelle');
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'ishelle');
    assert.match(ui.find((n) => n.props.role === 'status').props.children, /Selected Ishelle/);
    assert.equal(ui.all((n) => n.type === 'option' && n.props.value === 'jamaal').length, 0);
    ui.find((n) => n.type === 'select').props.onChange({ target: { value: 'ishelle-other' } });
    ui.render();
    await pause(20);
    ui.render();
    assert.equal(ui.find((n) => n.type === 'select').props.value, 'ishelle-other');
    await search('');
    assert.equal(
      ui.find((n) => n.type === 'select').props.value,
      'ishelle-other',
      'clear search retains the chosen requester',
    );
    fail = true;
    await search('offline');
    assert.equal(
      ui.find((n) => n.type === 'select').props.value,
      'ishelle-other',
      'failed search preserves the draft',
    );
    assert.equal(ui.find((n) => n.props.name === 'lookupLoadError').props.value, 'true');
    fail = false;
    await search('no matches');
    assert.equal(ui.find((n) => n.type === 'select').props.value, '');
    assert.equal(ui.find((n) => n.type === 'select').props.required, true);
    assert.match(ui.find((n) => n.props.role === 'status').props.children, /No matches/);
    assert.deepEqual(changes, ['ishelle', 'ishelle-other', '']);
  } finally {
    ui.close();
    globalThis.fetch = old;
  }
});
