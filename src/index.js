const SLACK_INVITE_URL = 'https://codebar.slack.com/api/users.admin.invite';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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

function failClosed() {
  return new Response(resultPage('Failed! Verification failed. Please try again.', true), {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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

const SLACK_USERS_LIST_URL = 'https://codebar.slack.com/api/users.list';

async function checkToken(token) {
  const resp = await fetch(SLACK_USERS_LIST_URL + '?limit=1', {
    headers: { Authorization: 'Bearer ' + token },
  });
  return resp.json();
}

async function sendWebhookAlert(url, text) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/invite') {
      try {
        const form = await request.formData();
        const email = (form.get('email') || '').trim();
        const turnstileToken = form.get('cf-turnstile-response') || '';

        if (!email) {
          return new Response(resultPage('Failed! your email is required.', true), {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        if (!env.TURNSTILE_SECRET) {
          console.log({ event: 'turnstile_secret_missing' });
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
          return new Response(
            resultPage('Failed! Something has gone wrong. Please contact a system administrator.', true),
            { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        if (slack.ok) {
          return new Response(
            resultPage(`Success! Check “${escapeHtml(email)}” for an invite from Slack.`),
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        if (slack.error === 'already_invited' || slack.error === 'already_in_team') {
          return new Response(
            resultPage(
              `Success! You were already invited.<br>Visit <a href="https://codebar.slack.com">codebar</a>`
            ),
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        let message = 'Something has gone wrong. Please contact a system administrator.';
        if (slack.error === 'invalid_email') {
          message = 'The email you entered is an invalid email.';
        }
        return new Response(resultPage(`Failed! ${message}`, true), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (error) {
        console.log({ event: 'invite_failed', error: String(error) });
        return new Response(
          resultPage('Failed! Something has gone wrong. Please contact a system administrator.', true),
          { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await checkToken(env.SLACK_TOKEN);
          if (result.ok) {
            console.log({ event: 'health_check_ok' });
            return;
          }
          const error = result.error || 'unknown error';
          console.log({ event: 'health_check_failed', error });
          if (env.ALERT_WEBHOOK_URL) {
            await sendWebhookAlert(
              env.ALERT_WEBHOOK_URL,
              `slack-invite health check FAILED: ${error} (workspace: codebar)`
            );
          }
        } catch (error) {
          console.log({ event: 'health_check_failed', error: String(error) });
          if (env.ALERT_WEBHOOK_URL) {
            await sendWebhookAlert(
              env.ALERT_WEBHOOK_URL,
              `slack-invite health check FAILED: ${String(error)} (workspace: codebar)`
            );
          }
        }
      })()
    );
  },
};