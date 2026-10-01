import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Dedicated project for the fail-closed test: TURNSTILE_SECRET is deliberately
// absent from bindings. Excluded from the default suite (see vitest.config.js).
export default defineWorkersConfig({
  test: {
    include: ['test/invite-nosecret.test.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            SLACK_TOKEN: 'test-slack-token',
            ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test/webhook',
          },
        },
      },
    },
  },
});