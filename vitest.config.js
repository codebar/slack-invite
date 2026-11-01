import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const testBindings = {
  SLACK_TOKEN: 'test-slack-token',
  TURNSTILE_SECRET: 'test-turnstile-secret',
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
    exclude: ['test/invite-nosecret.test.js', 'test/invite-noslack.test.js', '**/node_modules/**'],
    setupFiles: ['./test/setup.js'],
  },
});
