import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { network } from './network.js';

// Unhandled outbound requests are refused by the network itself ('error'
// strategy instead of the passthrough default), so no leak ever reaches the
// real upstreams; the tracked events then fail the owning test afterwards.
// The old fetchMock.disableNetConnect() gave us equivalent loudness.
const unhandled = [];
export function clearUnhandled() {
  unhandled.length = 0;
}
network.events.on('request:unhandled', ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

beforeAll(async () => {
  network.configure({ onUnhandledFrame: 'error' });
  await network.enable();
});

afterEach(() => {
  if (unhandled.length > 0) {
    const details = unhandled.join('\n  ');
    clearUnhandled();
    expect.fail(`Outbound request(s) without a matching mock:\n  ${details}`);
  }
});

afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
