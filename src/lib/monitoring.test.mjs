import assert from 'node:assert/strict';
import test from 'node:test';

import { configureMonitoring } from '../../scripts/configure-monitoring.mjs';

test('monitor setup reuses availability, creates readiness, and confines credentials to intended hosts', async () => {
  const saved = new Map([
    ['live', { id: 'live', attributes: { url: 'https://www.fixxflow.app/api/health/live' } }],
  ]);
  const methods = [];
  const request = async (url, options) => {
    const target = new URL(url);
    assert.equal(options.redirect, 'error');
    assert.equal(
      options.headers.authorization,
      target.hostname === 'www.fixxflow.app' ? 'Bearer health-secret' : 'Bearer provider-secret',
    );
    if (target.hostname === 'www.fixxflow.app')
      return Response.json({ status: 'ready', checks: { database: 'ok' } });
    assert.equal(target.hostname, 'incidents.betterstack.com');
    if (target.search)
      return Response.json({ data: [...saved.values()], pagination: { next: null } });
    if (options.method) {
      methods.push(options.method);
      const attributes = JSON.parse(options.body);
      assert.deepEqual(
        attributes.request_headers,
        attributes.url.endsWith('/ready')
          ? [{ name: 'Authorization', value: 'Bearer health-secret' }]
          : [],
      );
      const id = options.method === 'POST' ? 'ready' : 'live';
      saved.set(id, { id, attributes: { ...attributes, status: 'up' } });
      return Response.json({ data: saved.get(id) });
    }
    return Response.json({ data: saved.get(target.pathname.split('/').at(-1)) });
  };
  const evidence = await configureMonitoring({
    token: 'provider-secret',
    readinessToken: 'health-secret',
    request,
  });
  assert.deepEqual(methods, ['PATCH', 'POST']);
  assert.equal(evidence.length, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /secret/);
});

test('unhealthy database prevents provider changes', async () => {
  let requests = 0;
  await assert.rejects(
    configureMonitoring({
      token: 'provider-secret',
      readinessToken: 'health-secret',
      request: async () => {
        requests++;
        return Response.json({ status: 'unavailable' }, { status: 503 });
      },
    }),
    /HTTP 503/,
  );
  assert.equal(requests, 1);
});

test('provider errors cannot echo credential-bearing response bodies', async () => {
  await assert.rejects(
    configureMonitoring({
      token: 'provider-secret',
      readinessToken: 'health-secret',
      request: async (url) =>
        url.includes('www.fixxflow.app')
          ? Response.json({ status: 'ready', checks: { database: 'ok' } })
          : Response.json({ error: 'health-secret' }, { status: 422 }),
    }),
    (error) => !error.message.includes('health-secret') && error.message.includes('HTTP 422'),
  );
});
