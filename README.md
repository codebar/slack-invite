# slack-invite

The "join codebar on Slack" page for codebar, running on Cloudflare Workers. Serves the form at `https://slack.codebar.io`, verifies submissions with Turnstile, and sends Slack invites through the legacy `users.admin.invite` API.

This replaces the previous Heroku app (`codebar/slack-invite-automation`). It keeps only the behaviour production actually used: the invite form and submission. Things with no traffic — the badge endpoint, reCAPTCHA, locale variants — are gone.

## How it works

- `GET /` serves a static form (`public/index.html`) with a Cloudflare Turnstile widget.
- `POST /invite` verifies the Turnstile token, then calls Slack's `users.admin.invite` with the workspace token. Failures map to short messages: missing email, Turnstile failure, invalid email, already invited / already in team, and generic errors.
- A daily scheduled check (cron, added at cutover — see comment in `wrangler.jsonc`) calls `users.list` with the Slack token. On failure it posts an alert to `ALERT_WEBHOOK_URL`. This exists because the legacy token is a consumable secret that Slack can revoke at any time.

## Secrets

| Variable | Purpose |
|---|---|
| `TURNSTILE_SECRET` | Turnstile site verification |
| `SLACK_TOKEN` | Legacy Slack workspace token (`xoxp-`) |
| `ALERT_WEBHOOK_URL` | Webhook for the daily health check |

The Turnstile site key sits in `public/index.html` as the placeholder `SITE_KEY_PLACEHOLDER` and gets swapped for the real key at cutover. Site keys are public, so it goes into git then.

## Development

```sh
npm install
npm run dev      # wrangler dev, serves the local worker
npm test         # three vitest suites (see below)
```

## Tests

`npm test` runs three suites:

1. `vitest.config.js` — the full suite: invite flow, static assets, worker wiring, scheduled health check.
2. `vitest.nosecret.config.js` — proves nothing is sent to Slack when secrets are unset (fail-closed).
3. `vitest.noslack.config.js` — proves the real Slack endpoint is never reached, even when secrets exist.

## Deploy

Pushing to `main` runs the test suite and, on green, deploys via `wrangler-action` (`deploy.yml`). Deploy needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets, with `wrangler.jsonc` driving the config.

## Design docs

`docs/superpowers/` holds the design spec and implementation plan for the rewrite, including the production analysis that decided what was in scope.
