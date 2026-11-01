# Tasks

## 1. Add invite_outcome events to the request path (src/index.js)

- [ ] 1.1 Log `invite_outcome` for the missing-email branch (`detail: 'missing_email'`) — verify by running the Nosecret config test suite and asserting the new event appears for the missing-email case
- [ ] 1.2 Log `invite_outcome` for the missing-secrets branch (`detail: 'secrets_missing'`) alongside the existing `secrets_missing` event — verify via the existing missing-secrets test run plus one new assertion
- [ ] 1.3 Log `invite_outcome` for the Turnstile-verification-error branch (`detail: 'verification_error'`) alongside the existing `turnstile_verify_error` event — verify via the existing fetch-error test plus one new assertion
- [ ] 1.4 Log `invite_outcome` for the Turnstile-verification-failed branch (`detail: 'verification_failed'`), which currently logs nothing — verify by adding a test asserting both the 403 page and the event
- [ ] 1.5 Log `invite_outcome` for the Slack-unreachable branch (`detail: 'slack_unreachable'`) alongside the existing `slack_unreachable` event — verify via the existing unreachable test plus one new assertion
- [ ] 1.6 Log `invite_outcome` with `outcome: 'success'`, `detail: 'invited'` when Slack returns `ok: true`, with no `slack_error` field and no email value — verify by adding a test asserting the event and the absence of the submitted email in the log payload
- [ ] 1.7 Log `invite_outcome` for the mapped-error transitions: `already_invited` / `already_in_team` as `outcome: 'success'`, `invalid_email` as `outcome: 'failure'`, each carrying the exact Slack string in `slack_error` — verify by extending the existing mapped-error tests with event assertions
- [ ] 1.8 Log `invite_outcome` with the verbatim unmapped Slack error in `slack_error` for the generic-error branch — verify by adding a test with a never-before-seen error string (for example `inviter_email_not_verified`) asserting HTTP 200 plus the event
- [ ] 1.9 Log `invite_outcome` with `detail: 'unexpected_error'` in the top-level catch alongside the existing `invite_failed` event — verify via the existing unexpected-error test plus one new assertion

## 2. Static and 404 paths stay quiet (src/index.js)

- [ ] 2.1 Confirm asset serving and the plain 404 response emit no `invite_outcome` events — verify by extending the static-test suite to assert absence of the event

## 3. Full verification (test/, full suites)

- [ ] 3.1 Run the complete test suites (`vitest.config.js`, `vitest.nosecret.config.js`, `vitest.noslack.config.js`) and confirm all pass — verify via `npx vitest run --config <file>` exit code 0 for all three
- [ ] 3.2 Exercise the real worker end-to-end in `wrangler dev` for one success-shaped and one unmapped-error-shaped request and confirm the console shows `invite_outcome` lines — verify by inspecting dev-server output

## Workflow follow-up

- Implementation lands through a feature branch and a draft PR against codebar/slack-invite (never the default branch directly).
- After merge and deploy, a repeat submission against slack.codebar.io should produce an `invite_outcome` event visible in the Cloudflare dashboard live logs.
- The Cloudflare → Grafana ingestion pipeline and dashboard are a separate change, explored once this one is merged.
