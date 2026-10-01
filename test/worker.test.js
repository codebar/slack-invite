import { it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

it('non-asset GETs fall through to the Worker and return 404', async () => {
  const res = await SELF.fetch('https://slack.codebar.io/favicon.ico');
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('Not Found');
});
