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
// option is ignored), so `times: N` stacks N identical single-use
// interceptors to serve N matching calls.
function stackIntercepts(origin, path, body, times) {
  fetchMock.activate();
  const client = fetchMock.get(origin);
  for (let i = 0; i < times; i++) {
    client.intercept({ method: 'POST', path }).reply(200, body);
  }
}

export function mockTurnstile(body, { times = 1 } = {}) {
  stackIntercepts('https://challenges.cloudflare.com', '/turnstile/v0/siteverify', body, times);
}

export function mockSlackInvite(body, { times = 1 } = {}) {
  stackIntercepts('https://codebar.slack.com', '/api/users.admin.invite', body, times);
}

export function postInvite(fields, opts = {}) {
  return SELF.fetch('https://slack.codebar.io/invite', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
}
export function mockUsersList(body, { times = 1 } = {}) {
  fetchMock.activate();
  const client = fetchMock.get('https://codebar.slack.com');
  for (let i = 0; i < times; i++) {
    client.intercept({ method: 'GET', path: '/api/users.list?limit=1' }).reply(200, body);
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
