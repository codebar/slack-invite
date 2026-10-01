import { it, expect } from 'vitest';
import { postInvite, mockTurnstile, mockSlackInvite } from './helpers.js';

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