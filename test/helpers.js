import { SELF, fetchMock } from 'cloudflare:test';

export function postInvite(fields, opts = {}) {
  return SELF.fetch('https://slack.codebar.io/invite', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
}

export function mockTurnstile(body) {
  fetchMock.activate();
  fetchMock
    .get('https://challenges.cloudflare.com')
    .intercept({ method: 'POST', path: '/turnstile/v0/siteverify' })
    .reply(200, body);
}

export function mockSlackInvite(body) {
  fetchMock.activate();
  fetchMock
    .get('https://codebar.slack.com')
    .intercept({ method: 'POST', path: '/api/users.admin.invite' })
    .reply(200, body);
}