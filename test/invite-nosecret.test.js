import { it, expect } from 'vitest';
import { postInvite } from './helpers.js';

// Runs only under vitest.nosecret.config.js (no TURNSTILE_SECRET binding).
it('fails closed when TURNSTILE_SECRET is unset', async () => {
  const res = await postInvite({ email: 'a@b.com' }, { unsetSecret: true });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});