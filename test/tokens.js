// Shared test-secret values. The vitest configs bind them into the Workers
// runtime and the MSW handlers assert against them, so the two copies come
// from one source instead of drifting apart.
export const TEST_SLACK_TOKEN = 'test-slack-token';
export const TEST_WEBHOOK_URL = 'https://hooks.slack.com/services/test/webhook';
