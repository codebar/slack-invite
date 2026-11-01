import { defineConfig } from 'vitest/config';

// Node-side assertions that cannot run inside the Workers runtime: config-file
// and filesystem checks the plugin runtime cannot express. Runs separately
// (see the `test` script) from the Workers-runtime suites.
export default defineConfig({
  test: {
    include: ['test/config-pin.test.js'],
  },
});
