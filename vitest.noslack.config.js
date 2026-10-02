import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Dedicated project for the fail-closed test: SLACK_TOKEN is deliberately
// absent from bindings. Excluded from the default suite (see vitest.config.js).
export default defineWorkersConfig({
  test: {
    include: ['test/invite-noslack.test.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TURNSTILE_SECRET: 'test-turnstile-secret',
            ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test/webhook',
          },
        },
      },
    },
  },
});
