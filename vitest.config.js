import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const testBindings = {
  SLACK_TOKEN: 'test-slack-token',
  TURNSTILE_SECRET: 'test-turnstile-secret',
  ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test/webhook',
};

export default defineWorkersConfig({
  test: {
    exclude: ['test/invite-nosecret.test.js', 'test/invite-noslack.test.js', '**/node_modules/**'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: testBindings },
      },
    },
  },
});