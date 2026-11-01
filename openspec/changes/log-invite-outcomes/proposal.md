# Proposal

## Why

The 2026-10 incident (planner#3069) showed the invite worker's Slack-error branch returns an HTTP 200 page and logs nothing, so a Slack-side change (`inviter_email_not_verified`) made invites fail for weeks while Cloudflare dashboards showed zero errors. Every failure and success branch must emit one structured log event so Workers Logs (and a future Grafana dashboard) can identify invite outcomes, including Slack error strings the worker has never seen.

## What Changes

- Add a single structured log event, `invite_outcome`, emitted on every `POST /invite` branch: `{ event: 'invite_outcome', outcome: 'success' | 'failure', detail, slack_error }`.
  - `outcome: 'success'` with `detail: 'invited'` for actual invitations.
  - `already_invited` / `already_in_team` are logged as `outcome: 'success'` with their Slack error also recorded in `slack_error`.
  - `invalid_email`, turnstile failures, missing email, unreachable Slack, unexpected errors log as `outcome: 'failure'` with a `detail` key; the raw Slack error string is always copied to `slack_error` for any `ok:false` Slack response, mapped or not.
- Keep all existing log events (`secrets_missing`, `turnstile_verify_error`, `slack_unreachable`, `invite_failed`, health-check events) unchanged; the new event is additive.
- No change to HTTP status codes or user-facing page text; pages stay 200 for handled Slack errors.
- No PII logging: email addresses are not copied into `invite_outcome`.

## Capabilities

### New Capabilities

- `invite-observability`: Structured, complete logging of invite-processing outcomes (request branch, Slack response, health check) so external failures are identifiable in Workers Logs without redeploying instrumentation.

### Modified Capabilities

(none — the project has no existing specs)

## Impact

- `src/index.js`: one added log statement per branch (additive; public page responses unchanged).
- `test/`: existing failure-shape tests keep passing; new cases assert the `invite_outcome` event on each branch (success, mapped error, unmapped error, already-invited, turnstile fail, missing email).
- Downstream: enables the planned Cloudflare Workers Logs → Grafana ingestion work (separate change), which will consume `invite_outcome` as its primary series.
