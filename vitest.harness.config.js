import { defineConfig } from 'vitest/config';

// invite_outcome event assertions run through wrangler's createTestHarness
// (Node side, server.getLogs()); the Workers-runtime suites use the plugin
// configs and cannot capture console output.
export default defineConfig({
  test: {
    include: ['test/logs.test.js'],
  },
});
