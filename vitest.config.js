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
    // variants); test/logs.test.js and test/config-pin.test.js run on the
    // Node side (createTestHarness needs Node; config-pin reads config files
    // with fs) and fail here under the plugin runtime.
    exclude: ['test/invite-nosecret.test.js', 'test/invite-noslack.test.js', 'test/logs.test.js', 'test/config-pin.test.js', '**/node_modules/**'],
    setupFiles: ['./test/setup.js'],
  },
});
