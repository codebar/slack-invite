import { it, expect, beforeEach } from 'vitest';
import { mockUsersList, mockWebhook, mockUsersListThrows, mockWebhookThrows, runScheduled, resetFetchMocks } from './helpers.js';

beforeEach(async () => {
  await resetFetchMocks();
});

it('logs and stays quiet when the token works', async () => {
  mockUsersList({ ok: true });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(0);
});

it('sends the Bearer token to users.list', async () => {
  // Matching on the Authorization header makes this discriminating: a missing
  // or wrong header leaves the request unmatched and the check alerts.
  mockUsersList({ ok: true }, { headers: { authorization: 'Bearer test-slack-token' } });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(0);
});

it('posts exactly one alert when the token is rejected', async () => {
  mockUsersList({ ok: false, error: 'invalid_auth' });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(1);
  expect(webhook.body.text).toContain('slack-invite health check FAILED');
});

it('posts exactly one alert when users.list fails before a JSON answer', async () => {
  mockUsersListThrows();
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(1);
});

it('posts exactly one alert and keeps the token-failure text when the webhook throws', async () => {
  mockUsersList({ ok: false, error: 'invalid_auth' });
  mockWebhookThrows();
  await runScheduled();
});
