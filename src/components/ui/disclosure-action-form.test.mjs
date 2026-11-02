import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

for (const fails of [false, true]) {
  test(`native action ${fails ? 'failure retains the editor' : 'success closes its editor and restores focus'}`, async () => {
    let open = true,
      focused = false;
    const h = componentHarness(
      'src/components/ui/disclosure-action-form.tsx',
      'DisclosureActionForm',
      {
        children: 'Fields',
        action: async () => {
          if (fails) throw new Error('Save failed');
        },
      },
    );
    try {
      const form = h.find((node) => node.type === 'form');
      form.props.ref.current = {
        closest: () => ({
          set open(value) {
            open = value;
          },
          querySelector: () => ({
            focus() {
              focused = true;
            },
          }),
        }),
      };
      if (fails) await assert.rejects(form.props.action(new FormData()), /Save failed/);
      else await form.props.action(new FormData());
      assert.equal(open, fails);
      assert.equal(focused, !fails);
    } finally {
      h.close();
    }
  });
}
