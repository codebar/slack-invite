import { it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

it('serves the join page from static assets', async () => {
  const res = await SELF.fetch('https://slack.codebar.io/');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<form method="post" action="/invite">');
  expect(html).toContain('name="email"');
  expect(html).toContain('cf-turnstile');
  expect(html).toMatch(/<label[^>]*for="slack-email"/);
});