import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const origin = 'https://www.fixxflow.app';
const api = 'https://incidents.betterstack.com/api/v2';

export async function configureMonitoring({ token, readinessToken, request = fetch }) {
  assert.ok(token && readinessToken, 'Both monitoring credentials are required');
  async function call(url, options = {}) {
    const response = await request(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    // Never include provider bodies or request options: they may contain credentials.
    assert.ok(response.ok, `Monitoring request failed: HTTP ${response.status}`);
    return response.json();
  }
  const ready = await call(`${origin}/api/health/ready`, {
    headers: { authorization: `Bearer ${readinessToken}` },
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.checks?.database, 'ok');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const monitors = [];
  let page = 1;
  while (true) {
    const result = await call(`${api}/monitors?page=${page}`, { headers });
    monitors.push(...result.data);
    if (!result.pagination?.next) break;
    assert.ok(++page <= 100, 'Unexpected monitor pagination');
  }
  const evidence = [];
  for (const [path, name, keyword] of [
    ['/api/health/live', 'FixxFlow availability', '"status":"ok"'],
    ['/api/health/ready', 'FixxFlow database readiness', '"status":"ready"'],
  ]) {
    const url = origin + path;
    const existing = monitors.filter((m) => m.attributes.url === url);
    assert.ok(existing.length <= 1, 'Duplicate production monitors require review');
    const configuration = {
      url,
      pronounceable_name: name,
      monitor_type: 'keyword',
      required_keyword: keyword,
      check_frequency: 180,
      request_timeout: 10,
      confirmation_period: 0,
      recovery_period: 180,
      email: true,
      sms: false,
      call: false,
      push: false,
      paused: false,
      follow_redirects: false,
      verify_ssl: true,
      http_method: 'GET',
      request_headers: path.endsWith('/ready')
        ? [{ name: 'Authorization', value: `Bearer ${readinessToken}` }]
        : [],
    };
    const endpoint = existing.length
      ? `${api}/monitors/${encodeURIComponent(existing[0].id)}`
      : `${api}/monitors`;
    const saved = await call(endpoint, {
      method: existing.length ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(configuration),
    });
    const { data } = await call(`${api}/monitors/${encodeURIComponent(saved.data.id)}`, {
      headers,
    });
    for (const key of [
      'url',
      'monitor_type',
      'required_keyword',
      'check_frequency',
      'email',
      'follow_redirects',
      'verify_ssl',
    ]) {
      assert.equal(data.attributes[key], configuration[key], `Monitor setting mismatch: ${key}`);
    }
    evidence.push({
      id: data.id,
      url,
      status: data.attributes.status,
      checkFrequency: data.attributes.check_frequency,
      email: data.attributes.email,
    });
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(
        await configureMonitoring({
          token: process.env.BETTER_STACK_UPTIME_API_TOKEN,
          readinessToken: process.env.HEALTH_CHECK_SECRET,
        }),
      ),
    );
  } catch {
    console.error(
      'Monitoring configuration failed. Check credentials, production readiness, and provider settings. No credentials logged.',
    );
    process.exitCode = 1;
  }
}
