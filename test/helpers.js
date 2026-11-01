import { SELF } from 'cloudflare:test';
import { http } from 'msw';
import { network } from './network.js';
import { clearUnhandled } from './setup.js';
import { TEST_SLACK_TOKEN, TEST_WEBHOOK_URL } from './tokens.js';

// Upstream URLs the worker talks to.
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SLACK_INVITE_URL = 'https://codebar.slack.com/api/users.admin.invite';
const USERS_LIST_URL = 'https://codebar.slack.com/api/users.list';
const WEBHOOK_URL = TEST_WEBHOOK_URL;

export async function resetFetchMocks() {
  // Clears handlers registered by earlier tests in this file; the setup file
  // re-arms nothing: each test mocks only what the worker path under test
  // calls, and the setup-level unhandled-request guard catches the rest.
  network.resetHandlers();
  clearUnhandled();
}

// `once: true` handlers are consumed first-in/first-out, mirroring one
// stacked interceptor serving exactly one request.
function stackOnce(method, url, reply, times) {
  const handlers = [];
  for (let i = 0; i < times; i++) {
    handlers.push(method(url, reply, { once: true }));
  }
  network.use(...handlers);
}

const jsonReply = (status, body) => async () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// `record` (an array) captures the outbound request body of every call, so
// tests can assert what the worker actually sends upstream.
function maybeRecorded(reply, record) {
  if (!record) return reply;
  // formData(), not text(): workerd refuses plain-text reads of urlencoded
  // bodies, while parsing them as form data is warning-free.
  return async (params) => {
    const form = await params.request.clone().formData();
    record.push(new URLSearchParams(form).toString());
    return reply(params);
  };
}

function mockUpstreamJson(method, url, body, { times = 1, record, status = 200 } = {}) {
  stackOnce(method, url, maybeRecorded(jsonReply(status, body), record), times);
}

export function mockTurnstile(body, { times = 1, record } = {}) {
  mockUpstreamJson(http.post, TURNSTILE_VERIFY_URL, body, { times, record });
}

export function mockSlackInvite(body, { times = 1, record } = {}) {
  mockUpstreamJson(http.post, SLACK_INVITE_URL, body, { times, record });
}

// Raw (non-JSON) upstream bodies: real siteverify/Slack responses are HTML
// error pages or plain-text 5xx during incidents, never well-formed JSON.
export function mockTurnstileRaw(raw, { status = 200, times = 1 } = {}) {
  stackOnce(http.post, TURNSTILE_VERIFY_URL, async () => new Response(raw, { status }), times);
}

export function mockSlackInviteRaw(raw, { status = 200, times = 1 } = {}) {
  stackOnce(http.post, SLACK_INVITE_URL, async () => new Response(raw, { status }), times);
}

// Transport-level failures (a fetch that rejects: DNS, TLS, timeout) are not
// representable under MSW: HttpResponse.error() leaks unhandled rejections
// into the vitest run, and a throwing handler surfaces as a 500 response.
// implausibleUpstream() drives the same worker branch — the response parses
// fine but its body defeats resp.json(), hitting the before-JSON catch in
// src/index.js. The 599 status and body match nothing the worker maps.
function implausibleUpstream() {
  return new Response('upstream exploded', { status: 599 });
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

export function mockUsersList(body, { times = 1 } = {}) {
  // Checking the Authorization header keeps the assertion discriminating: a
  // missing or wrong header fails the test near the call site instead of
  // quietly exercising a different path. The expected value comes from the
  // same constant the configs bind as SLACK_TOKEN.
  stackOnce(
    http.get,
    USERS_LIST_URL,
    ({ request }) => {
      const auth = request.headers.get('authorization') ?? '';
      if (auth !== `Bearer ${TEST_SLACK_TOKEN}`) {
        throw new Error(`users.list mock called with wrong Authorization header: '${auth}'`);
      }
      return Response.json(body);
    },
    times
  );
}

export function mockUsersListThrows() {
  stackOnce(http.get, USERS_LIST_URL, implausibleUpstream, 1);
}

export function mockWebhook({ status = 200 } = {}) {
  const recorder = { calls: 0, body: null };
  network.use(
    http.post(WEBHOOK_URL, async ({ request }) => {
      recorder.calls += 1;
      const raw = await request.clone().text();
      try {
        recorder.body = JSON.parse(raw);
      } catch {
        recorder.body = { raw };
      }
      return new Response('deliberately implausible webhook reply', { status });
    })
  );
  return recorder;
}

export function mockWebhookThrows() {
  network.use(http.post(WEBHOOK_URL, implausibleUpstream));
}

export async function runScheduled() {
  const { env } = await import('cloudflare:test');
  const worker = (await import('../src/index.js')).default;
  const deferred = [];
  const ctx = { waitUntil: (p) => deferred.push(Promise.resolve(p)) };
  await worker.scheduled({}, env, ctx);
  await Promise.all(deferred);
}
