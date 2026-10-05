import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadAndRegister, validAttachment } from './uploads.ts';

test('attachments reject empty, oversized and unsupported files', () => {
  assert.equal(validAttachment({ type: 'image/png', size: 1 }), true);
  assert.equal(validAttachment({ type: 'image/png', size: 0 }), false);
  assert.equal(validAttachment({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }), false);
  assert.equal(validAttachment({ type: 'text/html', size: 1 }), false);
});

test('upload failure never registers a record', async () => {
  for (const upload of [async () => ({ error: 'failed' }), async () => { throw Error('offline'); }]) {
    assert.equal(await uploadAndRegister({ upload, register: () => assert.fail('must not register'), remove: () => assert.fail('must not remove') }), 'upload-failed');
  }
});

test('explicit registration failure cleans up; cleanup failure remains recoverable', async () => {
  for (const fails of [false, true]) {
    let removed = false;
    const result = await uploadAndRegister({ upload: async () => ({ error: null }), register: async () => ({ error: { code: '42501', message: 'denied' } }), remove: async () => { removed = true; if (fails) throw Error('offline'); } });
    assert.equal(result, 'registration-failed');
    assert.equal(removed, true);
  }
});

test('a lost registration response preserves the potentially committed file', async () => {
  const result = await uploadAndRegister({ upload: async () => ({ error: null }), register: async () => { throw Error('lost response'); }, remove: () => assert.fail('potentially saved file must survive') });
  assert.equal(result, 'unconfirmed');
});

test('confirmed registration leaves the file intact', async () => {
  assert.equal(await uploadAndRegister({ upload: async () => ({ error: null }), register: async () => ({ error: null }), remove: () => assert.fail('must not remove') }), 'saved');
});


test('returned network failures and uncertain transaction outcomes also preserve uploads', async () => {
  for (const error of [{ code: '', message: 'TypeError: fetch failed' }, { code: '40003' }, { code: '08007' }]) {
    assert.equal(await uploadAndRegister({ upload: async () => ({ error: null }), register: async () => ({ error }), remove: () => assert.fail('uncertain writes must retain the file') }), 'unconfirmed');
  }
});
