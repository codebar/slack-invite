import { SELF, fetchMock } from 'cloudflare:test';

const MOCKED_ORIGINS = ['https://challenges.cloudflare.com', 'https://codebar.slack.com', 'https://hooks.slack.com'];

// Closing each origin's mock client drops its interceptors — registrations
// would otherwise persist for the whole file and match before newer ones.
export async function resetFetchMocks() {
  for (const origin of MOCKED_ORIGINS) {
    await fetchMock.get(origin).close();
  }
  fetchMock.activate();
  // Unmatched outbound calls throw instead of silently hitting the real API —
  // a wrong interceptor path then fails loudly rather than passing by luck.
  fetchMock.disableNetConnect();
}

// workerd's undici treats every interceptor as single-use (the `times`
// option is ignored), so one interceptor is stacked per expected call.
function stackIntercepts(origin, { method, path, times = 1, reply }) {
  fetchMock.activate();
  const client = fetchMock.get(origin);
  for (let i = 0; i < times; i++) {
    client.intercept({ method, path }).reply(reply);
  }
}

const jsonReply = (status, body) => () => ({ statusCode: status, data: body });

// `record` (an array) captures the outbound request body of every call, so
// tests can assert what the worker actually sends upstream.
function maybeRecorded(reply, record) {
  return record ? (opts) => { record.push(opts.body); return reply(opts); } : reply;
}

function mockUpstreamJson(origin, method, path, body, { times = 1, record, status = 200 } = {}) {
  stackIntercepts(origin, {
    method,
    path,
    times,
    reply: maybeRecorded(jsonReply(status, JSON.stringify(body)), record),
  });
}

export function mockTurnstile(body, { times = 1, record } = {}) {
  mockUpstreamJson('https://challenges.cloudflare.com', 'POST', '/turnstile/v0/siteverify', body, { times, record });
}

export function mockSlackInvite(body, { times = 1, record } = {}) {
  mockUpstreamJson('https://codebar.slack.com', 'POST', '/api/users.admin.invite', body, { times, record });
}

// Raw (non-JSON) upstream bodies: real siteverify/Slack responses are HTML
// error pages or plain-text 5xx during incidents, never well-formed JSON.
export function mockTurnstileRaw(body, { status = 200, times = 1 } = {}) {
  stackIntercepts('https://challenges.cloudflare.com', {
    method: 'POST',
    path: '/turnstile/v0/siteverify',
    times,
    reply: jsonReply(status, body),
  });
}

export function mockSlackInviteRaw(body, { status = 200, times = 1 } = {}) {
  stackIntercepts('https://codebar.slack.com', {
    method: 'POST',
    path: '/api/users.admin.invite',
    times,
    reply: jsonReply(status, body),
  });
}

export function mockTurnstileThrows() {
  stackIntercepts('https://challenges.cloudflare.com', {
    method: 'POST',
    path: '/turnstile/v0/siteverify',
    reply: () => { throw new Error('boom'); },
  });
}

export function postInvite(fields) {
  return SELF.fetch('https://slack.codebar.io/invite', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
}

export function postInviteRaw(headers, body) {
  return SELF.fetch('https://slack.codebar.io/invite', { method: 'POST', headers, body });
}

export function mockUsersList(body, { times = 1, headers } = {}) {
  fetchMock.activate();
  const client = fetchMock.get('https://codebar.slack.com');
  const options = { method: 'GET', path: '/api/users.list?limit=1' };
  // Header matchers make the assertion discriminating: a missing or wrong
  // Authorization header leaves the request unmatched and the test fails.
  if (headers) options.headers = headers;
  for (let i = 0; i < times; i++) {
    client.intercept(options).reply(jsonReply(200, JSON.stringify(body)));
  }
}

export function mockWebhook() {
  fetchMock.activate();
  const recorder = { calls: 0, body: null };
  fetchMock
    .get('https://hooks.slack.com')
    .intercept({ method: 'POST', path: '/services/test/webhook' })
    .reply((opts) => {
      recorder.calls += 1;
      try {
        recorder.body = JSON.parse(opts.body);
      } catch {
        recorder.body = { raw: String(opts.body) };
      }
      return { statusCode: 200, data: 'ok' };
    });
  return recorder;
}

export async function runScheduled() {
  const { env } = await import('cloudflare:test');
  const worker = (await import('../src/index.js')).default;
  const deferred = [];
  const ctx = { waitUntil: (p) => deferred.push(Promise.resolve(p)) };
  await worker.scheduled({}, env, ctx);
  await Promise.all(deferred);
}
