// Log-event assertions for the invite_outcome series. The vitest-plugin
// runtime exposes no console capture, so this suite runs the Worker through
// wrangler's createTestHarness (Node side), whose server.getLogs() returns
// the Worker's console output. See design.md — the application-decision-2.
import { beforeAll, it, expect, afterAll, afterEach, describe, vi } from 'vitest';
import { createTestHarness } from 'wrangler';

const FULL_SECRETS = { SLACK_TOKEN: 'test-slack-token', TURNSTILE_SECRET: 'test-turnstile-secret' };

let server;

beforeAll(async () => {
  server = createTestHarness({
    workers: [{ configPath: './wrangler.jsonc', secrets: FULL_SECRETS }],
  });
  await server.listen();
});

afterEach(async () => {
  await server.reset();
});

afterAll(async () => {
  await server.close();
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

function outcomeEvents() {
  return server
    .getLogs()
    .filter((entry) => {
      const msg = String(entry.message ?? '');
      return msg.includes("event: 'invite_outcome'");
    })
    .map((entry) => String(entry.message));
}

function expectSingleOutcome(outcome, detail, slackError) {
  const events = outcomeEvents();
  expect(events.length, `expected exactly one invite_outcome event, saw ${events.length}`).toBe(1);
  expect(events[0]).toContain(`outcome: '${outcome}'`);
  expect(events[0]).toContain(`detail: '${detail}'`);
  if (slackError === undefined) {
    expect(events[0]).not.toContain('slack_error');
  } else {
    expect(events[0]).toContain(`slack_error: '${slackError}'`);
  }
}

describe('POST /invite outcomes', () => {
  it('logs success with no slack_error and no email when the invite succeeds', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: true }),
    });
    try {
      const res = await postInvite({ email: 'pi.Person161+probe@roderick.dk' });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('success', 'invited');
    expect(outcomeEvents()[0]).not.toContain('pi.Person161');
  });

  it('logs already_invited as success with the slack string', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error: 'already_invited' }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('success', 'slack_error', 'already_invited');
  });

  it('logs invalid_email as failure with the slack string', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error: 'invalid_email' }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_error', 'invalid_email');
  });

  it('logs a never-seen Slack error verbatim (the #3069 shape)', async () => {
    const spy = fetchSpyFor({
      'challenges.cloudflare.com': () => Response.json({ success: true }),
      'users.admin.invite': () => Response.json({ ok: false, error: 'inviter_email_not_verified' }),
    });
    try {
      const res = await postInvite({ email: 'a@b.com' });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Something has gone wrong');
    } finally {
      spy.mockRestore();
    }
    expectSingleOutcome('failure', 'slack_error', 'inviter_email_not_verified');
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
});
