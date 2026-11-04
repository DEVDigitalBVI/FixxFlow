import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { passwordRequirements, passwordMeetsPolicy } = load('src/features/auth/password-policy.ts');
test('password rules require the same character groups as the provider and preserve intentional whitespace', () => {
  assert.equal(passwordMeetsPolicy('password'), false);
  assert.equal(passwordMeetsPolicy('LongSentenceWithoutDigits!'), false);
  assert.equal(passwordMeetsPolicy('Example9!'), true);
  assert.equal(passwordMeetsPolicy(' Example9! '), true);
  assert.equal(passwordMeetsPolicy('ABCDEF9!'), false);
  assert.equal(passwordMeetsPolicy('abcdef9!'), false);
  assert.equal(passwordMeetsPolicy('Example99'), false);
  assert.equal(passwordMeetsPolicy('Abc1!😀'), false);
  assert.equal(passwordRequirements.find((r) => r.id === 'symbol').test('é'), false);
});
test('requirements change from red X states to check marks while typing, and confirmation tracks later password edits', () => {
  const h = componentHarness('src/features/auth/password-fields.tsx', 'PasswordFields', {});
  const input = (name) => h.find((n) => n.type === 'input' && n.props.name === name);
  const rules = () => h.all((n) => n.type === 'li');
  try {
    assert.equal(rules().length, 6);
    assert.ok(rules().every((n) => n.props['data-met'] === false));
    input('password').props.onChange({ target: { value: 'Example9!' } });
    h.render();
    assert.equal(rules().filter((n) => n.props['data-met']).length, 5);
    input('passwordConfirmation').props.onChange({ target: { value: 'Example9!' } });
    h.render();
    assert.ok(rules().every((n) => n.props['data-met'] === true));
    input('password').props.onChange({ target: { value: 'example' } });
    h.render();
    assert.equal(rules().at(-1).props['data-met'], false);
    input('password').props.onBlur();
    h.render();
    assert.equal(input('password').props['aria-invalid'], true);
    assert.equal(input('password').props.autoComplete, 'new-password');
    assert.ok(input('password').props['aria-describedby']);
    assert.ok(h.find((n) => n.props.role === 'status').props['aria-live'] === 'polite');
  } finally {
    h.close();
  }
});
test('weak and unchanged passwords get actionable errors without telling users to resend a valid link', async () => {
  let code = 'weak_password';
  let updates = 0;
  const logs = [];
  const { updatePassword } = load('src/app/(auth)/actions.ts', {
    'next/navigation': {
      redirect: (path) => {
        throw Error(path);
      },
    },
    '@/lib/server-errors': { reportServerError: (...args) => logs.push(args) },
    '@/features/product-analytics/actions': { recordCompletedLogin: async () => {} },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          updateUser: async () => {
            updates++;
            return { error: { code, message: 'sensitive raw provider text' } };
          },
        },
      }),
    },
  });
  const form = new FormData();
  form.set('password', 'Example9!');
  form.set('passwordConfirmation', 'Example9!');
  await assert.rejects(
    () => updatePassword(form),
    (error) =>
      decodeURIComponent(error.message).includes('stronger+password') &&
      !error.message.includes('sensitive'),
  );
  code = 'same_password';
  await assert.rejects(
    () => updatePassword(form),
    (error) => decodeURIComponent(error.message).includes('already+your+current+password'),
  );
  assert.equal(updates, 2);
  assert.deepEqual(logs[0], ['auth.password.update', { code: 'weak_password' }]);
  form.set('password', 'weak');
  form.set('passwordConfirmation', 'weak');
  await assert.rejects(() => updatePassword(form));
  assert.equal(updates, 2, 'server checks complexity before updating Auth');
});
