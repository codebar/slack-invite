import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';

// The vitest-plugin dispatches requests straight to the Worker, so there is no
// asset router in front of SELF/exports.default the way production has. The
// join page is served by the ASSETS binding, so bind-level assertions are what
// this runtime can actually see.
it('serves the join page from static assets', async () => {
  const res = await env.ASSETS.fetch('https://internal/index.html');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<form method="post" action="/invite">');
  expect(html).toContain('name="email"');
  expect(html).toContain('cf-turnstile');
  expect(html).toMatch(/<label[^>]*for="slack-email"/);
});

it('serves the stylesheet from static assets', async () => {
  const res = await env.ASSETS.fetch('https://internal/style.css');
  expect(res.status).toBe(200);
  expect(await res.text()).not.toBe('');
});
