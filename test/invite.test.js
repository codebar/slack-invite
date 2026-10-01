import { it, expect, beforeEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { postInvite, mockTurnstile, mockSlackInvite, resetFetchMocks } from './helpers.js';

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

it('HTML-escapes the email in the response', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'x"><script>alert(1)</script>@b.com' });
  const html = await res.text();
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

it('escapes the email even on the already-invited page', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'already_in_team' });
  const res = await postInvite({ email: '<b>@b.com' });
  expect(await res.text()).not.toContain('<b>@b.com');
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

it('accepts repeat submissions for an already-invited email', async () => {
  mockTurnstile({ success: true }, { times: 2 });
  mockSlackInvite({ ok: false, error: 'already_in_team' }, { times: 2 });
  const first = await postInvite({ email: 'a@b.com' });
  const second = await postInvite({ email: 'a@b.com' });
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
});
