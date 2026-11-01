import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const testBindings = {
  SLACK_TOKEN: 'test-slack-token',
  ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test/webhook',
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
