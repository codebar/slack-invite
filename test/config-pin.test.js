// Runs on the Node side (vitest.node.config.js). The plugin runtime dispatches
// SELF/exports.default straight to the Worker with no asset router in front,
// so the assets-first production routing can only be pinned at config level:
// read wrangler.jsonc and fail if the routing decision changes.
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';

it('keeps the join page served by the asset router before the Worker', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  expect(config).toMatch(/"directory"\s*:\s*"[.]{0,2}\/?public"/);
  // run_worker_first would make the Worker claim '/' and shadow the join page.
  expect(config).not.toMatch(/run_worker_first/);
});

it('ships the join page files the asset router serves', () => {
  for (const file of ['index.html', 'style.css']) {
    expect(() => readFileSync(new URL(`../public/${file}`, import.meta.url))).not.toThrow();
  }
});
