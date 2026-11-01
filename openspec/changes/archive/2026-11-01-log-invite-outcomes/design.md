# Design

## Context

`src/index.js` handles `POST /invite` with ten terminal branches. Six already log structured events (`secrets_missing`, `turnstile_verify_error`, `slack_unreachable`, `invite_failed`, plus the scheduled health-check events); four log nothing: turnstile-verification-failed, invalid-email, already-invited, and the unmapped-Slack-error branch that hid planner#3069 for weeks. Slack documents 44 error strings for the invite endpoint and has shown it adds new ones silently, so a fixed mapping table can never guarantee visibility. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- Every terminal branch of `POST /invite` produces one machine-readable `invite_outcome` event, additive to existing events.
- Raw Slack error strings reach Workers Logs even when unmapped.
- No change to HTTP statuses, page text, or existing event shapes (tests pin those).
- Grafana-ready: a single series (`event=invite_outcome`) covers success/failure breakout and Slack-error grouping.

**Non-Goals:**
- Changing the user-facing error messages or status codes.
- Mapping new Slack errors to friendly pages (separate, later change if wanted).
- PII in logs (no email values, no names).
- The Cloudflare → Grafana ingestion pipeline and dashboard (separate change after this merges).

## Decisions

**1. One event per branch, not per sub-attempt.** `invite_outcome` is logged once, at the point each branch returns its response. Alternative considered: logging each Slack response separately plus a request-level rollup — rejected, two events per request double the intake for zero dashboard benefit.

**2. `slack_error` carries the verbatim Slack string for every `ok:false` response, mapped or not.** This is the property that makes future Slack-side changes immediately visible. Alternative considered: only logging unknown errors — rejected; dashboards need the mapped-error series (`already_invited`, `invalid_email`) too, and `slack_error` plus `detail` agree by construction.

**3. `detail` uses stable short keys, not the Slack error, for non-Slack branches.** Keys: `missing_email`, `verification_error`, `verification_failed`, `secrets_missing`, `slack_unreachable`, `unexpected_error`, `invited`, plus `slack_error:<string>`-summary via `detail: 'slack_error'` when the Slack call returns an error (with `slack_error` holding the string). Rationale: `detail` is low-cardinality and dashboard-groupable; the high-cardinality string lives in its own field so an unrelated Slack rename cannot fragment the detail series.

**4. Emit inside each return path, not from a wrapper.** The branches build different `Response` objects; a single wrapper around every return would need state threading for marginal benefit. Straight-line `console.log(...)` next to each return keeps the diff small and reviewable. Alternative considered: try/finally wrapper keyed on a mutable outcome variable — rejected as more machinery for the same observable result.

**5. Existing events stay.** `secrets_missing` / `slack_unreachable` / `invite_failed` / `turnstile_verify_error` are pinned by tests and carry the distinctive message payloads (for example turnstile error-codes). `invite_outcome` duplicates some of their information by design; Cloudflare intake for this worker is tiny (81 events in a week), so the redundancy is cheap.

## Risks / Trade-offs

- [Some risk of a missing branch producing no event] → The tasks list enumerates all ten branches explicitly; the test suite asserts one `invite_outcome` per terminal branch scenario, so a gap shows as a failing test rather than a silent hole.
- [Log volume slightly up (two events on some failure paths)] → Intake for this worker is a few thousand events/month at current traffic; negligible cost.
- [New Slack error strings still render the generic page] → Accepted: user-facing text genericity is the point; identifiability comes from `slack_error`.

## Migration Plan

Deploy is the rollout: additive logging, no data or config changes. Rollback is a revert re-deploy. No coordination with the Grafana work needed; it builds on the deployed series afterwards.

## Open Questions

(none)
