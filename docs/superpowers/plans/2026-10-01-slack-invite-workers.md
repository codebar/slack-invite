# Slack invite Workers rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Heroku `slack-invite-automation` app with a Cloudflare Worker serving `slack.codebar.io`: static join page, Turnstile-protected invite POST, daily token health check.

**Architecture:** Static-first — the join page is a Workers Static Asset that never invokes the Worker; the Worker handles `POST /invite` (Turnstile verify → Slack legacy invite call) and a `scheduled()` health check. Zero runtime dependencies.

**Tech Stack:** Cloudflare Workers (JavaScript, wrangler v4), Vitest + `@cloudflare/vitest-pool-workers`, GitHub Actions (`cloudflare/wrangler-action@v3`).

**Spec:** `docs/superpowers/specs/2026-10-01-slack-invite-workers-design.md` (in this repository once created; until then it lives beside this plan in the staging checkout).

## Global Constraints

- JavaScript only; no runtime dependencies. Dev dependencies: `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`.
- Slack workspace URL is `https://codebar.slack.com` (hardcoded; matches production `SLACK_URL`).
- Legacy invite endpoint: `POST https://codebar.slack.com/api/users.admin.invite`, form-encoded `email`, `token`, `set_active=true`.
- Health check endpoint: `GET https://codebar.slack.com/api/users.list?limit=1`, `Authorization: Bearer <token>`.
- Turnstile verify: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, form-encoded `secret`, `response`.
- Secrets (Worker secrets, never committed): `SLACK_TOKEN`, `TURNSTILE_SECRET`, `ALERT_WEBHOOK_URL`.
- Copy strings are fixed: success `Success! Check “{email}” for an invite from Slack.`; already-invited `Success! You were already invited.` plus link to `https://codebar.slack.com`; invalid email `The email you entered is an invalid email.`; unknown Slack error `Something has gone wrong. Please contact a system administrator.`; Turnstile failure `Verification failed. Please try again.`; missing email `your email is required`; 404 body `Not Found`.
- Visitor-visible email must be HTML-escaped everywhere it is interpolated.
- Free tier only: no paid features, no KV/D1/Queues.
- Every task ends with a commit; tests run green before each commit.

## Review Focus

- Interpolated email in HTML responses (XSS) → pinned by the escaping test in Task 3.
- Missing `TURNSTILE_SECRET` env at runtime → verification fails closed (403 + error log), never an invite → pinned by test in Task 4.
- Duplicate-submission behaviour: repeated POSTs for the same email must return the already-invited success page, not an error page → pinned by test in Task 4.
- Cron alert must fire exactly once per failed check, and must not fire on success → pinned by tests in Task 5.
- `GET /favicon.ico` and other non-asset GETs fall through to the Worker → must return the `Not Found` 404 page, not an exception → pinned by test in Task 1.

---

### Task 1: Repository scaffold with a minimal Worker

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `vitest.config.js`, `src/index.js`, `test/worker.test.js`, `.gitignore`
- Create repo: `codebar/slack-invite` on GitHub (private or public to match codebar norms — matching planner: public), commit spec and plan as the first commit.

**Interfaces:**
- Produces: Worker default export shape `{ fetch(request, env, ctx) }` used by all later tasks. Env bindings read as `env.SLACK_TOKEN`, `env.TURNSTILE_SECRET`, `env.ALERT_WEBHOOK_URL` (unset in this task; tests set them via the pool-workers miniflare env).
- Produces: `wrangler.jsonc` with `name: "slack-invite"`, `main: "src/index.js"`, `compatibility_date` current, `assets: { directory: "./public", binding: "ASSETS" }` (directory created empty in this task, filled in Task 2), `observability: { enabled: true }`, `triggers.crons: ["0 6 * * *"]`.

- [ ] **Step 1: Write the failing test** — in `test/worker.test.js`, using helpers from `cloudflare:test` (`SELF`):

```js
import { SELF } from 'cloudflare:test';
it('non-asset GETs fall through to the Worker and return 404', async () => {
  const res = await SELF.fetch('https://slack.codebar.io/favicon.ico');
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('Not Found');
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run` → FAIL (no Worker yet).
- [ ] **Step 3: Implement** `src/index.js` default export: `fetch` returns a 404 text response `Not Found` for any request in this task. `scheduled` exported as a no-op stub (filled in Task 5).
- [ ] **Step 4: Run tests, verify pass** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `chore: scaffold worker with wrangler and vitest`

### Task 2: Static join page

**Files:**
- Create: `public/index.html`, `public/style.css`, `test/static.test.js`

**Interfaces:**
- Consumes: assets binding from Task 1's `wrangler.jsonc`.
- Produces: form markup consumed by Task 3: `<form method="post" action="/invite">` containing `<input type="email" name="email" required>`, the Turnstile widget `<div class="cf-turnstile" data-sitekey="...">`, and the Turnstile script tag `https://challenges.cloudflare.com/turnstile/v0/api.js`. The site key is inserted as the literal placeholder `SITE_KEY_PLACEHOLDER` in this task and swapped for the real key at cutover (Task 6) — keeping it out of git is not required (site keys are public), but the placeholder keeps dev/cutover explicit.

- [ ] **Step 1: Write the failing smoke test**

```js
import { SELF } from 'cloudflare:test';
it('serves the join page from static assets', async () => {
  const res = await SELF.fetch('https://slack.codebar.io/');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<form method="post" action="/invite">');
  expect(html).toContain('name="email"');
  expect(html).toContain('cf-turnstile');
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run` → FAIL (no page).
- [ ] **Step 3: Implement** the page: codebar-branded, single email field, Turnstile widget, submit button. Styling in `public/style.css`; system font stack; no external CSS or font requests except the Turnstile script.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat: join page as static asset with Turnstile widget`

### Task 3: POST /invite — validation, Turnstile verify, Slack happy path

**Files:**
- Modify: `src/index.js`
- Create: `test/invite.test.js`, `test/helpers.js`

**Interfaces:**
- Consumes: `env.TURNSTILE_SECRET`, `env.SLACK_TOKEN` (present in tests via pool-workers env config).
- Produces: `test/helpers.js` — shared test helpers, extended by Tasks 4 and 5:
  - `postInvite(fields, opts = {})` → issues `SELF.fetch('https://slack.codebar.io/invite', { method: 'POST', body: new URLSearchParams(fields) })`; `opts.unsetSecret` runs the request in an env without `TURNSTILE_SECRET` (pool-workers per-test env override).
  - `mockTurnstile({ success })` → `fetchMock.get('https://challenges.cloudflare.com/turnstile/v0/siteverify', { success })`.
  - `mockSlackInvite({ ok, error? })` → `fetchMock.get('https://codebar.slack.com/api/users.admin.invite', { ok, error })`.
  Later tasks add `mockUsersList(body)` and `mockWebhook()` (returns `{ calls, body }` recording calls) and `runScheduled()` (invokes the Worker's `scheduled` handler with a stub controller/context).
- Produces: fetch-handler flow used by Task 4: parse form body → validate email present → verify Turnstile → call Slack → map response. Result-page rendering is one internal helper, `resultPage(message, isFailed)`, returning a full HTML string; tests assert on `status` and that the body contains the fixed copy strings from Global Constraints.
- Mocking: use `fetchMock` from `cloudflare:test` (`fetchMock.activate()`, then `fetchMock.get(url-pattern)` per upstream). Slack URL pattern: `https://codebar.slack.com/api/users.admin.invite`; Turnstile: `https://challenges.cloudflare.com/turnstile/v0/siteverify`.

- [ ] **Step 1: Write failing tests**

```js
it('rejects submissions without an email', async () => {
  const res = await postInvite({ email: '' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('your email is required');
});

it('sends the invite and shows success on ok', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Success! Check “a@b.com” for an invite from Slack.');
});

it('HTML-escapes the email in the response', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: true });
  const res = await postInvite({ email: 'x"><script>alert(1)</script>@b.com' });
  const html = await res.text();
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

it('escapes the email even on the already-invited page', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'already_in_team' });
  const res = await postInvite({ email: '<b>@b.com' });
  expect(await res.text()).not.toContain('<b>@b.com');
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the flow in `src/index.js`: form parse → email required (400) → Turnstile `siteverify` POST with `secret`/`response` (fail → 403 `Verification failed. Please try again.`, covered further in Task 4) → Slack invite POST → `ok: true` → 200 success page. Email interpolation goes through an `escapeHtml()` helper.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat: invite submission with Turnstile verification`

### Task 4: POST /invite — error mapping

**Files:**
- Modify: `src/index.js`
- Modify: `test/invite.test.js`

**Interfaces:**
- Consumes: the Task 3 flow and its `test/helpers.js` helpers (no new interfaces; tests may import `postInvite` with `unsetSecret`).

- [ ] **Step 1: Write failing tests**

```js
it.each([
  ['already_invited'], ['already_in_team'],
])('maps %s to the already-invited success page', async (error) => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Success! You were already invited.');
  expect(html).toContain('https://codebar.slack.com');
});

it('maps invalid_email to the invalid-email message', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'invalid_email' });
  const res = await postInvite({ email: 'a@b.com' });
  expect(await res.text()).toContain('The email you entered is an invalid email.');
});

it('hides unmapped Slack errors behind the generic message', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'failed_to_send_invite' });
  const res = await postInvite({ email: 'a@b.com' });
  expect(await res.text()).toContain('Something has gone wrong. Please contact a system administrator.');
});

it('fails closed when Turnstile rejects', async () => {
  mockTurnstile({ success: false });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain('Verification failed. Please try again.');
});

it('fails closed when TURNSTILE_SECRET is unset', async () => {
  const res = await postInvite({ email: 'a@b.com', unsetSecret: true });
  expect(res.status).toBe(403);
});

it('returns 502 when Slack is unreachable', async () => {
  mockTurnstile({ success: true });
  fetchMock.get('https://codebar.slack.com/api/users.admin.invite', () => { throw new Error('boom'); });
  const res = await postInvite({ email: 'a@b.com' });
  expect(res.status).toBe(502);
});

it('accepts repeat submissions for an already-invited email', async () => {
  mockTurnstile({ success: true });
  mockSlackInvite({ ok: false, error: 'already_in_team' });
  const first = await postInvite({ email: 'a@b.com' });
  const second = await postInvite({ email: 'a@b.com' });
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
});
```

- [ ] **Step 2: Run, verify FAIL on the new cases (Task 3 cases keep passing).**
- [ ] **Step 3: Implement** the error mapping table from the spec, the unset-secret fail-closed branch (verify with empty string → treat as verification failure, log `turnstile_secret_missing`), 502 on Slack fetch rejection, and the top-level try/catch → 500 with logged detail.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat: map Slack and Turnstile failure modes`

### Task 5: Scheduled token health check

**Files:**
- Modify: `src/index.js`
- Create: `test/scheduled.test.js`

**Interfaces:**
- Consumes: `env.SLACK_TOKEN`, `env.ALERT_WEBHOOK_URL` from Worker secrets; `test/helpers.js` gains `mockUsersList(body)`, `mockWebhook()`, and `runScheduled()` (signatures in Task 3's Interfaces block).
- Produces: `scheduled(controller, env, ctx)` default-exported from the same Worker. On failure it POSTs JSON `{ text: <alert string> }` to `env.ALERT_WEBHOOK_URL` (Slack incoming-webhook shape). Alert string: `slack-invite health check FAILED: <error> (workspace: codebar)`.
- Mocking: `fetchMock` for `https://codebar.slack.com/api/users.list` and the webhook URL.

- [ ] **Step 1: Write failing tests**

```js
it('logs and stays quiet when the token works', async () => {
  mockUsersList({ ok: true });
  const webhook = mockWebhook(); // returns the recorded call count
  await runScheduled();
  expect(webhook.calls).toBe(0);
});

it('posts exactly one alert when the token is rejected', async () => {
  mockUsersList({ ok: false, error: 'invalid_auth' });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(1);
  expect(webhook.body.text).toContain('slack-invite health check FAILED');
});

it('posts exactly one alert when users.list is unreachable', async () => {
  fetchMock.get('https://codebar.slack.com/api/users.list', () => { throw new Error('boom'); });
  const webhook = mockWebhook();
  await runScheduled();
  expect(webhook.calls).toBe(1);
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `scheduled()`: `users.list` GET with Bearer token via `ctx.waitUntil`; on failure, log a structured error (`{ event: 'health_check_failed', error }`) and POST the alert. Success logs `{ event: 'health_check_ok' }`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat: daily Slack token health check with webhook alert`

### Task 6: Deploy, cutover, decommission checklist

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `public/index.html` (real Turnstile site key), `wrangler.jsonc` (route)

**Interfaces:**
- Consumes: everything above. No code interfaces; this task is platform wiring plus the manual checklist the spec's cutover section requires.

- [ ] **Step 1: Implement** `deploy.yml`: on push to `main`, `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`.
- [ ] **Step 2: Set up (manual, once):** in the codebar Cloudflare account — create the `slack-invite` Worker, `wrangler deploy` locally first; `wrangler secret put SLACK_TOKEN` (copy value from `heroku config -a codebar-slack-invitation`), `wrangler secret put TURNSTILE_SECRET`, `wrangler secret put ALERT_WEBHOOK_URL`; create the Turnstile widget (managed, invisible mode) for hostnames `slack.codebar.io` and the temporary `*.workers.dev` hostname, install its keys; set repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Until cutover, `public/index.html` and the widget use Turnstile **test keys** (dummy always-pass key pair from Cloudflare's Turnstile docs) so the live check works on `*.workers.dev`.
- [ ] **Step 3: Verify** — push to `main`, confirm the action deploys, submit the live form on the workers.dev URL with a controlled address, confirm the invite email arrives and the log shows `health_check_ok` after the next scheduled run (or run `wrangler triggers` / invoke manually via `wrangler dev --test-scheduled`).
- [ ] **Step 4: Cutover (manual):** swap the Turnstile placeholder/test keys for the real keys and redeploy; on the `codebar.io` zone replace the Heroku CNAME with a proxied record for `slack.codebar.io` and add the Worker route `slack.codebar.io/*`; re-run the live form check on the production hostname.
- [ ] **Step 5: Commit** — `chore: production Turnstile keys and route`
- [ ] **Step 6: Decommission (one week later, manual):** confirm Worker logs show successful invites over the week, then delete the `codebar-slack-invitation` Heroku app.

---

## Out of plan scope (tracked, not built here)

- If Slack retires `users.admin.invite`: fall back to Slack's built-in invite link (a static page edit, no code). The cron alert makes the failure visible the day it happens.
