# codebar Slack invite page on Cloudflare Workers — design

Date: 2026-10-01
Status: draft for review
Replaces: codebar/slack-invite-automation on Heroku (app `codebar-slack-invitation`)

## Purpose

Serve the "join codebar on Slack" page at `https://slack.codebar.io` and process
invite submissions, as a Cloudflare Worker instead of the current Heroku app. The
rewrite covers only the behaviour the production app actually exercises, plus
four agreed modernisations.

## Background: what is actually used

Analysis of production (2026-09-30, Heroku config + router logs over ~25 hours +
GitHub code search):

- Used: `GET /` (linked from ~30 places across codebar properties), `POST /invite`
  (~4 real submissions per day, all from residential IPs). Config in production is
  four variables: `COMMUNITY_NAME`, `LOCALE=en`, `SLACK_TOKEN`, `SLACK_URL`.
- Unused: `/badge.svg` (zero requests, zero embeds in any codebar repo), reCAPTCHA
  (not configured), `INVITE_TOKEN` gate (not configured), `SUBPATH` (default),
  15 of 16 locales.
- Traffic mix: ~81% of requests are bot noise (WordPress probe scans) that hit
  non-existent paths.

## Constraint: the Slack token

The app calls the undocumented legacy method `users.admin.invite` with a legacy
workspace token (`xoxp-` prefix, 73 chars). Verified 2026-09-30:

- The endpoint still works with this token (auth passes; `users.list` returns ok).
- The method is absent from Slack's official API spec and its docs page is gone
  (404 redirect). Slack no longer issues legacy tokens.
- There is no supported replacement on the Free plan (`admin.users.invite` is
  Enterprise-only; built-in invite links have no API).

Consequence: the rewrite keeps this method and treats the token as a consumable
secret. The scheduled health check exists to detect token revocation the day it
happens. If Slack retires the endpoint, the fallback is Slack's built-in invite
link, not more code.

## Goals

1. Same URLs, same user-visible flow, same error messages.
2. Zero runtime dependencies; JavaScript; Workers-native APIs only.
3. Bot protection via Cloudflare Turnstile.
4. Redesigned, accessible join page with codebar styling.
5. Daily health check of the Slack token with alerting.
6. Structured logging via Workers Logs.
7. Free tier only.

## Non-goals

- Multi-language support (English only).
- Badge endpoint.
- Email capture or an admin view of invitees (the current app never had one).
- Runtime-configurable community name or locale.
- Supporting any host other than Cloudflare Workers.

## Architecture

One Worker in a new repository (proposed name: `codebar/slack-invite`), bound to
`slack.codebar.io/*` on the `codebar.io` zone.

- `GET /` and all static requests are served by Workers Static Assets. These
  requests do not invoke Worker code: free, unlimited, edge-cached, and they
  absorb the bot noise without touching the Worker request budget.
- `POST /invite` is the only dynamic route; non-asset requests fall through to
  the Worker fetch handler.
- A Cron Trigger (daily) runs the token health check in `scheduled()`.
- Secrets: `SLACK_TOKEN`, `TURNSTILE_SECRET`, `ALERT_WEBHOOK_URL`.
- No KV, D1, Queues, or Durable Objects.

## Components

1. `public/index.html` — join page: codebar branding, email field, invisible
   Turnstile widget, submit button. "codebar" is hardcoded; it is the product's
   own name. Includes the Turnstile site key (public) and form client script
   (inline, a few lines).
2. `public/style.css` — codebar branding, system font stack, no external font CDN.
3. `src/index.js` — fetch handler (`POST /invite` + 404 fallback, try/catch
   around the flow) and scheduled handler.
4. `wrangler.jsonc` — assets binding, route, cron schedule,
   `observability.enabled` for Workers Logs.
5. `.github/workflows/deploy.yml` — deploy on push to `main` via
   `cloudflare/wrangler-action@v3`; secrets in repository settings.

## Data flow

1. Visitor requests `GET /` → static asset from the edge.
2. Form submit → Turnstile widget produces a token in the client →
   `POST /invite` with `email` and `cf-turnstile-response`.
3. Worker verifies the token against Turnstile `siteverify` (one fetch).
4. On success, Worker calls `https://codebar.slack.com/api/users.admin.invite`
   with the secret token, the submitted email, and `set_active=true` (one fetch).
5. Response mapped to a result page (see error handling) rendered from a
   template string.

## Error handling

| Case | Result |
| --- | --- |
| Turnstile verification fails or unreachable | 403, "verification failed, try again" page; no Slack call |
| Slack `already_invited` / `already_in_team` | Success page with workspace link (current behaviour) |
| Slack `invalid_email` | "The email you entered is an invalid email." |
| Any other Slack error string | "Something has gone wrong. Please contact a system administrator." (raw errors hidden from visitors, as today) |
| Slack unreachable or non-JSON | 502, generic error page, error logged |
| Unexpected exception in the request path | 500, generic error page, logged with detail |

Scheduled handler: calls `users.list` with `Authorization: Bearer` (works with
both legacy and modern tokens). On `ok: false` or fetch failure, logs a
structured error and POSTs a short alert to `ALERT_WEBHOOK_URL` (a Slack
incoming webhook in the codebar workspace). No alert on success; a single log
line records the check.

## Testing

- Vitest with `@cloudflare/vitest-pool-workers` (real workerd runtime).
  Upstream calls mocked: happy-path invite, each mapped Slack error, Turnstile
  rejection, Slack 500/non-JSON, scheduled handler ok/fail paths.
- Static page smoke test: served HTML contains the form, Turnstile site key,
  email field.
- One manual live check at cutover: submit the real form with a controlled
  address, confirm the invite email arrives.

No mutation testing or coverage targets; the app is ~200 lines.

## Cutover and rollback

1. Create the repo, deploy with a temporary test route on the zone.
2. Run the live end-to-end check against the test route.
3. Add a proxied DNS record for `slack.codebar.io` on the zone (replacing the
   CNAME to Heroku) and a route rule binding it to the Worker.
4. Keep the Heroku app running but idle for one week as the rollback path.
5. Decommission the Heroku app.

## Cost

Free tier. 100,000 requests/day and 10 ms CPU per invocation cover the traffic
with large headroom; only form submissions invoke the Worker. No paid plan
anticipated.

## Open questions

- Repo name: `codebar/slack-invite` is the proposal.
- Which Slack channel the `ALERT_WEBHOOK_URL` posts to.
- Exact date for Heroku decommissioning (one week after cutover is proposed).
