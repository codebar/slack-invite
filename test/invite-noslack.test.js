import { it, expect } from 'vitest';
import { postInvite } from './helpers.js';

// Runs only under vitest.noslack.config.js (no SLACK_TOKEN binding).
it('fails closed when SLACK_TOKEN is unset', async () => {
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});
