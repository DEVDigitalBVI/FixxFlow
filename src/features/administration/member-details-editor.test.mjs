import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
const require = createRequire(import.meta.url);
function setup(result) {
  const details = { open: true };
  let focused = false, saved = '', refs = 0;
  const mocks = {
    react: { ...React, useRef: () => ({ current: refs++ === 0 ? details : { focus: () => { focused = true; } } }), useState: () => [saved, value => { saved = value; }] },
    '@/components/ui/action-form': { ActionForm: () => null },
    '@/components/ui/submit-button': { SubmitButton: () => null },
    '@/app/app/people/actions': { updateMemberDetails: async () => { if (result instanceof Error) throw result; return result; } },
  };
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/features/administration/member-details-editor.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => mocks[name] ?? require(name), compiled, compiled.exports);
  const tree = compiled.exports.MemberDetailsEditor({ profile: { user_id: 'member', updated_at: 'revision' }, name: 'Member', departments: [], locations: [] });
  const disclosure = tree.props.children[0];
  return { save: disclosure.props.children[1].props.action, state: () => ({ open: details.open, focused, saved }), tree };
}
test('successful member save collapses the editor and returns focus to its summary', async () => {
  const editor = setup({ success: 'Member details saved.' });
  await editor.save(new FormData());
  assert.deepEqual(editor.state(), { open: false, focused: true, saved: 'Member details saved.' });
  assert.equal(editor.tree.props.children[1].props.role, 'status');
});
test('validation and network failures preserve the expanded editor', async () => {
  const invalid = setup({ error: 'Choose an active department.' });
  assert.deepEqual(await invalid.save(new FormData()), { error: 'Choose an active department.' });
  assert.deepEqual(invalid.state(), { open: true, focused: false, saved: '' });
  const failed = setup(Error('offline'));
  await assert.rejects(failed.save(new FormData()), /offline/);
  assert.deepEqual(failed.state(), { open: true, focused: false, saved: '' });
});
