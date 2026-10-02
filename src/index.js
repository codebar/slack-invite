const SLACK_INVITE_URL = 'https://codebar.slack.com/api/users.admin.invite';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SLACK_USERS_LIST_URL = 'https://codebar.slack.com/api/users.list';

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resultPage(message, isFailed = false) {
  const cls = isFailed ? ' failed' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>codebar Slack</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="card">
    <h1><strong>codebar</strong></h1>
    <p class="header" role="status"${cls}>${message}</p>
    <p><a href="/">Back</a></p>
  </main>
</body>
</html>`;
}

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

function htmlResponse(message, { status = 200, failed = false } = {}) {
  return new Response(resultPage(message, failed), { status, headers: HTML_HEADERS });
}

function failClosed() {
  return htmlResponse('Failed! Verification failed. Please try again.', { status: 403, failed: true });
}

async function verifyTurnstile(token, secret) {
  const resp = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token }),
  });
  return resp.json();
}

async function sendSlackInvite(email, token) {
  const resp = await fetch(SLACK_INVITE_URL, {
    method: 'POST',
    body: new URLSearchParams({ email, token, set_active: 'true' }),
  });
  return resp.json();
}

async function checkToken(token) {
  const resp = await fetch(SLACK_USERS_LIST_URL + '?limit=1', {
    headers: { Authorization: 'Bearer ' + token },
  });
  return resp.json();
}

async function sendWebhookAlert(url, text) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  // A non-2xx (expired webhook URL, 429, 5xx) is a silently dropped alert.
  if (!resp.ok) {
    console.log({ event: 'alert_delivery_failed', status: resp.status });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/invite') {
      try {
        const form = await request.formData();
        const emailField = form.get('email');
        const email = (typeof emailField === 'string' ? emailField : '').trim();
        const turnstileField = form.get('cf-turnstile-response');
        const turnstileToken = typeof turnstileField === 'string' ? turnstileField : '';

        if (!email) {
          return htmlResponse('Failed! your email is required.', { status: 400, failed: true });
        }

        if (!env.TURNSTILE_SECRET || !env.SLACK_TOKEN) {
          console.log({ event: 'secrets_missing', turnstile_secret: !env.TURNSTILE_SECRET, slack_token: !env.SLACK_TOKEN });
          return failClosed();
        }

        let verify;
        try {
          verify = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET);
        } catch (error) {
          console.log({ event: 'turnstile_verify_error', error: String(error) });
          return failClosed();
        }
        if (!verify.success) {
          return failClosed();
        }

        let slack;
        try {
          slack = await sendSlackInvite(email, env.SLACK_TOKEN);
        } catch (error) {
          console.log({ event: 'slack_unreachable', error: String(error) });
          return htmlResponse(
            'Failed! Something has gone wrong. Please contact a system administrator.',
            { status: 502, failed: true }
          );
        }
        if (slack.ok) {
          return htmlResponse(`Success! Check “${escapeHtml(email)}” for an invite from Slack.`);
        }
        if (slack.error === 'already_invited' || slack.error === 'already_in_team') {
          return htmlResponse(
            `Success! You were already invited.<br>Visit <a href="https://codebar.slack.com">codebar</a>`
          );
        }
        let message = 'Something has gone wrong. Please contact a system administrator.';
        if (slack.error === 'invalid_email') {
          message = 'The email you entered is an invalid email.';
        }
        return htmlResponse(`Failed! ${message}`, { failed: true });
      } catch (error) {
        console.log({ event: 'invite_failed', error: String(error) });
        return htmlResponse(
          'Failed! Something has gone wrong. Please contact a system administrator.',
          { status: 500, failed: true }
        );
      }
    }
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        let error;
        try {
          const result = await checkToken(env.SLACK_TOKEN);
          if (result.ok) {
            console.log({ event: 'health_check_ok' });
            return;
          }
          error = result.error || 'unknown error';
        } catch (cause) {
          error = String(cause);
        }
        console.log({ event: 'health_check_failed', error });
        if (env.ALERT_WEBHOOK_URL) {
          try {
            await sendWebhookAlert(
              env.ALERT_WEBHOOK_URL,
              `slack-invite health check FAILED: ${error} (workspace: codebar)`
            );
          } catch (deliveryError) {
            console.log({ event: 'alert_delivery_failed', error: String(deliveryError) });
          }
        }
      })()
    );
  },
};
