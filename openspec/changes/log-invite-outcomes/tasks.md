# Tasks

## 0. Test-stack migration (approved during apply: vitest 4 + Cloudflare vitest plugin)

- [x] 0.1 Migrate the suite to vitest 4 and @cloudflare/vitest-plugin; outbound mocks move from fetchMock to MSW (verified: `npm test` exit 0, all suites green)
- [x] 0.2 Add a createTestHarness-based log-assertion suite for invite_outcome events under vitest.harness.config.js (verified: log events asserted per branch below)

## 1. Add invite_outcome events to the request path (src/index.js)

- [x] 1.1 Log `invite_outcome` for the missing-email branch (`detail: 'missing_email'`) — asserted in test/logs.test.js; dev-server smoke shows the event on POST /invite with an empty email (400)
- [x] 1.2 Log `invite_outcome` for the missing-secrets branch (`detail: 'secrets_missing'`) alongside the existing `secrets_missing` event — asserted in test/logs.test.js
- [x] 1.3 Log `invite_outcome` for the Turnstile-verification-error branch (`detail: 'verification_error'`) alongside the existing `turnstile_verify_error` event — asserted in test/logs.test.js (non-JSON upstream reply)
- [x] 1.4 Log `invite_outcome` for the Turnstile-verification-failed branch (`detail: 'verification_failed'`), which previously logged nothing — asserted in test/logs.test.js; dev-server smoke shows the event on a rejected challenge (403)
- [x] 1.5 Log `invite_outcome` for the Slack-call-failure branch (`detail: 'slack_unreachable'`) alongside the existing `slack_unreachable` event — asserted in test/logs.test.js (non-JSON upstream reply drives 502)
- [x] 1.6 Log `invite_outcome` with `outcome: 'success'`, `detail: 'invited'` when Slack returns `ok: true`, with no `slack_error` field and no email value — asserted in test/logs.test.js (event holds no email substring)
- [x] 1.7 Log `invite_outcome` for the mapped-error transitions: `already_invited` / `already_in_team` as `outcome: 'success'`, `invalid_email` as `outcome: 'failure'`, each carrying the exact Slack string in `slack_error` — asserted in test/logs.test.js
- [x] 1.8 Log `invite_outcome` with the verbatim unmapped Slack error in `slack_error` for the generic-error branch — asserted with `inviter_email_not_verified` (the #3069 shape): HTTP 200 page plus the event
- [x] 1.9 Log `invite_outcome` with `detail: 'unexpected_error'` in the top-level catch alongside the existing `invite_failed` event — asserted in test/logs.test.js (non-form POST body drives 500)

## 2. Static and 404 paths stay quiet (src/index.js)

- [x] 2.1 Confirm asset serving and the plain 404 response emit no `invite_outcome` events — verified via the worker-404 test and the bootstrap-guard (no invite handler runs outside POST /invite terminal branches)

## 3. Full verification (test/, full suites)

- [x] 3.1 Run the complete test suites (`vitest.config.js`, `vitest.nosecret.config.js`, `vitest.noslack.config.js`, `vitest.node.config.js`, `vitest.harness.config.js`) and confirm all pass — verified: 23+1+1+2+9 tests all green, `npm test` exit 0
- [x] 3.2 Exercise the real worker end-to-end in `wrangler dev` and confirm the console shows `invite_outcome` lines — verified: missing-email → failure/missing_email (400) and rejected-Turnstile → failure/verification_failed (403) observed in dev output

## Workflow follow-up

- Implementation lands through a feature branch and a draft PR against codebar/slack-invite (never the default branch directly).
- After merge and deploy, a repeat submission against slack.codebar.io should produce an `invite_outcome` event visible in the Cloudflare dashboard live logs.
- The Cloudflare → Grafana ingestion pipeline and dashboard are a separate change, explored once this one is merged.
