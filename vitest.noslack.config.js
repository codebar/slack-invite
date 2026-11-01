import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const testBindings = {
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
    include: ['test/invite-noslack.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});
