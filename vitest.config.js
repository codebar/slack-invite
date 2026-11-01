import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_SLACK_TOKEN, TEST_WEBHOOK_URL } from './test/tokens.js';

const testBindings = {
  SLACK_TOKEN: TEST_SLACK_TOKEN,
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
    // invite-nosecret/noslack run under their own configs (secret-binding
    // variants); test/config-pin.test.js runs on the Node side (reads config
    // files with fs) and fails here under the plugin runtime.
    exclude: ['test/invite-nosecret.test.js', 'test/invite-noslack.test.js', 'test/config-pin.test.js', '**/node_modules/**'],
    setupFiles: ['./test/setup.js'],
  },
});
