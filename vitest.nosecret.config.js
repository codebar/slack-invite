import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_SLACK_TOKEN, TEST_WEBHOOK_URL } from './test/tokens.js';

const testBindings = {
  SLACK_TOKEN: TEST_SLACK_TOKEN,
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
    include: ['test/invite-nosecret.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});
