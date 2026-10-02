import { it, expect, beforeEach } from 'vitest';
import { fetchMock, SELF } from 'cloudflare:test';
import {
  postInvite,
  postInviteRaw,
  mockTurnstile,
  mockSlackInvite,
  mockTurnstileRaw,
  mockSlackInviteRaw,
  mockTurnstileThrows,
  resetFetchMocks,
} from './helpers.js';

beforeEach(async () => {
  await resetFetchMocks();
});

it('rejects submissions without an email', async () => {
  const res = await postInvite({ email: '' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('your email is required');
});

it('sends the invite and shows success on ok', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Success! Check “a@b.com” for an invite from Slack.');
});

it('sends the form values upstream: Slack invite body', async () => {
  const slackCalls = [];
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true }, { record: slackCalls });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(200);
  const sent = new URLSearchParams(slackCalls[0]);
  expect(sent.get('email')).toBe('a@b.com');
  expect(sent.get('set_active')).toBe('true');
  expect(sent.get('token')).toBe('test-slack-token');
});

it('sends the form values upstream: siteverify body', async () => {
  const siteverifyCalls = [];
  mockTurnstile({ success: true }, { record: siteverifyCalls });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'a@b.com', 'cf-turnstile-response': 'tok' });
  expect(res.status).toBe(200);
  const sent = new URLSearchParams(siteverifyCalls[0]);
  expect(sent.get('secret')).toBe('test-turnstile-secret');
  expect(sent.get('response')).toBe('tok');
});

it('HTML-escapes the email in the response', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'x"><script>alert(1)</script>@b.com' });
  const html = await res.text();
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

it.each([['already_invited'], ['already_in_team']])(
  'maps %s to the already-invited success page',
  async (error) => {
    mockTurnstile({ success: true });
    mockSlackInvite({ ok: false, error });
    const res = await postInvite({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Success! You were already invited.');
    expect(html).toContain('https://codebar.slack.com');
  }
);

it('maps invalid_email to the invalid-email message', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'invalid_email' });
  const res = await postInvite({ email: 'a@b.com' });
  expect(await res.text()).toContain('The email you entered is an invalid email.');
});

it('hides unmapped Slack errors behind the generic message', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'failed_to_send_invite' });
  const res = await postInvite({ email: 'a@b.com' });
  expect(await res.text()).toContain('Something has gone wrong. Please contact a system administrator.');
});

it('fails closed when Turnstile rejects', async () => {
  mockTurnstile({ success: false });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});

it('fails closed when the siteverify fetch throws', async () => {
  mockTurnstileThrows();
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});

it('fails closed when Turnstile answers a non-JSON error page', async () => {
  mockTurnstileRaw('<html>502 Service Unavailable</html>', { status: 502 });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});

it('returns 502 when Slack answers a non-JSON error page', async () => {
  mockTurnstile({ success: true });
  mockSlackInviteRaw('<html>oops</html>', { status: 503 });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(502);
  expect(await res.text()).toContain('Something has gone wrong. Please contact a system administrator.');
});

it('returns 502 when Slack answers 200 with a non-JSON body', async () => {
  mockTurnstile({ success: true });
  mockSlackInviteRaw('<html>ok</html>', { status: 200 });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(502);
});

it('returns 502 when Slack is unreachable', async () => {
  mockTurnstile({ success: true });
  fetchMock
    .get('https://codebar.slack.com')
    .intercept({ method: 'POST', path: '/api/users.admin.invite' })
    .reply(() => {
      throw new Error('boom');
    });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(502);
});

it('returns the generic 500 page for a non-form POST body', async () => {
  const res = await postInviteRaw({ 'Content-Type': 'application/json' }, '{}');
  expect(res.status).toBe(500);
  expect(await res.text()).toContain('Something has gone wrong. Please contact a system administrator.');
});

it('accepts repeat submissions for an already-invited email', async () => {
  mockTurnstile({ success: true }, { times: 2 });
  mockSlackInvite({ ok: false, error: 'already_in_team' }, { times: 2 });
  const first = await postInvite({ email: 'a@b.com' });
  const second = await postInvite({ email: 'a@b.com' });
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
});
