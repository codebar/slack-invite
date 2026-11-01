import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { network } from './network.js';

beforeAll(() => network.enable());

// Unhandled outbound requests would otherwise pass through to the real
// targets, so track them and fail the owning test instead. The old
// fetchMock.disableNetConnect() gave us the same loudness.
const unhandled = [];
network.events.on('request:unhandled', ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

afterEach(() => {
  if (unhandled.length > 0) {
    const details = unhandled.join('\n  ');
    unhandled.length = 0;
    expect.fail(`Outbound request(s) without a matching mock:\n  ${details}`);
  }
});

afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
