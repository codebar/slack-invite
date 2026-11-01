// Log-event assertions for the invite_outcome series. The vitest-plugin
// runtime exposes no console capture, so this suite runs the Worker through
// wrangler's createTestHarness (Node side), whose server.getLogs() returns
// the Worker's console output. Fits the design's observability layer: one
// event per terminal branch, verbatim slack_error, no PII.
import { beforeAll, it, expect, afterAll, afterEach, describe, vi } from 'vitest';
import { createTestHarness } from 'wrangler';

const FULL_SECRETS = { SLACK_TOKEN: 'test-slack-token', TURNSTILE_SECRET: 'test-turnstile-secret' };
// Sentinel for Slack replies with ok:false but no error field: the event must
// still carry slack_error so future Slack-side shapes stay visible (#3069).
const NO_ERROR_FIELD = '(no error field)';

let server;
let serverNoSecrets;

beforeAll(async () => {
  server = createTestHarness({
    workers: [{ configPath: './wrangler.jsonc', secrets: FULL_SECRETS }],
  });
  // Second instance for the secrets-missing branch: secrets unset on the
  // worker makes the fail-closed guard reachable for the log assertions.
  serverNoSecrets = createTestHarness({
    workers: [{ configPath: './wrangler.jsonc' }],
  });
  await Promise.all([server.listen(), serverNoSecrets.listen()]);
});

afterEach(async () => {
  await Promise.all([server.reset(), serverNoSecrets.reset()]);
});

afterAll(async () => {
  await Promise.all([server.close(), serverNoSecrets.close()]);
});

function postInvite(fields) {
  return server.fetch('https://slack.codebar.io/invite', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
}

const fetchSpyFor = (upstreams) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [fragment, response] of Object.entries(upstreams)) {
      if (url.includes(fragment)) return response();
    }
    throw new Error(`unmocked upstream in test: ${url}`);
  });

function outcomeEvents(harness = server) {
  return harness
    .getLogs()
    .filter((entry) => {
      const msg = String(entry.message ?? '');
      return msg.includes("event: 'invite_outcome'");
    })
    .map((entry) => String(entry.message));
}

function expectSingleOutcome(outcome, detail, slackError, { byEmail, harness = server } = {}) {
  const events = outcomeEvents(harness);
  expect(events.length, `expected exactly one invite_outcome event, saw ${events.length}`).toBe(1);
  expect(events[0]).toContain(`outcome: '${outcome}'`);
  expect(events[0]).toContain(`detail: '${detail}'`);
  if (slackError === undefined) {
    expect(events[0]).not.toContain('slack_error');
  } else {
    expect(events[0]).toContain(`slack_error: '${slackError}'`);
  }
  if (byEmail !== undefined) {
    // PII guard for every asserted event, not just success: logOutcome must
    // never transport the email we just submitted.
    expect(events[0]).not.toContain(byEmail);
  }
}

describe('POST /invite outcomes', () => {
  it('logs success with no slack_error and no email when the invite succeeds', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: true }),
    });
    const email = 'pi.Person161+probe@roderick.dk';
    try {
      const res = await postInvite({ email });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('success', 'invited', undefined, { byEmail: email });
  });

  it.each([['already_invited'], ['already_in_team']])('logs %s as success with the slack string', async (error) => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error }),
    });
    const email = 'a@b.com';
    try {
      const res = await postInvite({ email });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('success', 'slack_error', error, { byEmail: email });
  });

  it('logs invalid_email as failure with the slack string', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error: 'invalid_email' }),
    });
    const email = 'a@b.com';
    try {
      const res = await postInvite({ email });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_error', 'invalid_email', { byEmail: email });
  });

  it('logs a never-seen Slack error verbatim (the #3069 shape)', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error: 'inviter_email_not_verified' }),
    });
    const email = 'a@b.com';
    try {
      const res = await postInvite({ email });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Something has gone wrong');
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_error', 'inviter_email_not_verified', { byEmail: email });
  });

  it('keeps the slack_error field present when Slack answers ok:false without an error string', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false }),
    });
    const email = 'a@b.com';
    try {
      const res = await postInvite({ email });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Something has gone wrong');
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_error', NO_ERROR_FIELD, { byEmail: email });
  });

  it('logs the slack_unreachable branch', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => new Response('<html>oops</html>', { status: 503 }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(502);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_unreachable');
  });

  it('logs the missing-email branch', async () => {
    const res = await postInvite({ email: '' });
    expect(res.status).toBe(400);
    expectSingleOutcome('failure', 'missing_email');
  });

  it('logs the verification-failed branch', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: false }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(403);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'verification_failed');
  });

  it('logs the verification-error branch', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => new Response('<html>500</html>', { status: 502 }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(403);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'verification_error');
  });

  it('logs the unexpected_error branch for a non-form body', async () => {
    const res = await server.fetch('https://slack.codebar.io/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(500);
    expectSingleOutcome('failure', 'unexpected_error');
  });

  it('logs the secrets_missing branch when the Worker runs with no secrets', async () => {
    const res = await serverNoSecrets.fetch('https://slack.codebar.io/invite', {
      method: 'POST',
      body: new URLSearchParams({ email: 'a@b.com' }),
    });
    expect(res.status).toBe(403);
    expectSingleOutcome('failure', 'secrets_missing', undefined, { harness: serverNoSecrets });
  });

  it.each([
    ['favicon requests', 'https://slack.codebar.io/favicon.ico'],
    ['the join page request itself', 'https://slack.codebar.io/'],
  ])('stays quiet (no events) for %s handled outside the invite branch', async (_label, url) => {
    const res = await server.fetch(url);
    expect(res.status).toBe(404);
    expect(outcomeEvents()).toEqual([]);
  });
});
