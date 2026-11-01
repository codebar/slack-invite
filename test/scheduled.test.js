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
  // The users.list handler checks the Authorization header against the same
  // constant the configs bind as SLACK_TOKEN, so a missing or wrong header
  // fails this test instead of exercising a different branch.
  mockUsersList({ ok: true });
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

// A true fetch-level rejection (DNS/TLS/timeout) is not representable under
// MSW (see the comment in test/helpers.js), so this test pins the other
// delivery-failure branch the worker handles: the webhook answering non-2xx.
it('answers the failed user-list check with exactly one delivery attempt, keeping the token-failure text, when the webhook replies non-2xx', async () => {
  mockUsersList({ ok: false, error: 'invalid_auth' });
  const webhook = mockWebhook({ status: 599 });
  await expect(runScheduled()).resolves.toBeUndefined();
  expect(webhook.calls).toBe(1);
  expect(webhook.body.text).toContain('slack-invite health check FAILED');
  expect(webhook.body.text).toContain('invalid_auth');
});
