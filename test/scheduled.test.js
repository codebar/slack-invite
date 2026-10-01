import { it, expect, beforeEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { mockUsersList, mockWebhook, runScheduled, resetFetchMocks } from './helpers.js';

beforeEach(async () => {
  await resetFetchMocks();
});

it('logs and stays quiet when the token works', async () => {
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

it('posts exactly one alert when users.list is unreachable', async () => {
  fetchMock
    .get('https://codebar.slack.com')
    .intercept({ method: 'GET', path: '/api/users.list' })
    .reply(() => {
      throw new Error('boom');
    });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(1);
});
