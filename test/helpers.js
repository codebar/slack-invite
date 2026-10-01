import { SELF, fetchMock } from 'cloudflare:test';

const MOCKED_ORIGINS = ['https://challenges.cloudflare.com', 'https://codebar.slack.com'];

// Closing each origin's mock client drops its interceptors — registrations
// would otherwise persist for the whole file and match before newer ones.
export async function resetFetchMocks() {
  for (const origin of MOCKED_ORIGINS) {
    await fetchMock.get(origin).close();
  }
  fetchMock.activate();
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