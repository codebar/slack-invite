import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_SLACK_TOKEN, TEST_WEBHOOK_URL } from './test/tokens.js';

const testBindings = {
  TURNSTILE_SECRET: 'test-turnstile-secret',
  ALERT_WEBHOOK_URL: TEST_WEBHOOK_URL,
};

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: testBindings },
    }),
  ],
  test: {
    include: ['test/invite-noslack.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});
