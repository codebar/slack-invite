# Spec Delta

## Purpose

Emit one structured log event per invite-processing branch (request handling and Slack response) so any failure — including Slack error strings the worker does not yet know — is identifiable in Workers Logs, later Grafana dashboards, and incident reports, while user-facing page responses stay unchanged.

## ADDED Requirements

### Requirement: Log one invite_outcome event per processed invite submission

Every `POST /invite` request that reaches a terminal branch MUST log exactly one structured event with `event: 'invite_outcome'`, `outcome` (`'success'` or `'failure'`), `detail` (a stable short branch key), and `slack_error` whenever Slack returned `ok: false`.

#### Scenario: Success

- **WHEN** Slack returns `ok: true`
- **THEN** the log carries `outcome: 'success'`, `detail: 'invited'`, and no `slack_error` field.

#### Scenario: Mapped Slack errors keep their string

- **WHEN** Slack returns `already_invited`, `already_in_team`, or `invalid_email`
- **THEN** the log carries that exact string in `slack_error`, with `outcome: 'success'` for the first two and `outcome: 'failure'` for `invalid_email`.

#### Scenario: Unmapped Slack error is still visible

- **WHEN** Slack returns an error string the worker does not map
- **THEN** the response is the regular failure page (HTTP 200), and the log carries `outcome: 'failure'` with `slack_error` equal to the verbatim string.

#### Scenario: Slack call fails before a response

- **WHEN** the Slack HTTP call rejects
- **THEN** the log carries `outcome: 'failure'`, `detail: 'slack_unreachable'`.

#### Scenario: Unexpected exception

- **WHEN** an uncaught error terminates the request
- **THEN** the log carries `outcome: 'failure'`, `detail: 'unexpected_error'`.

### Requirement: Log non-Slack invite branch failures

Failures that terminate the request before the Slack call MUST be visible as `invite_outcome` events with `outcome: 'failure'` and a stable `detail` key, additive to any existing log events. Requests that never reach an invite branch MUST NOT log the event.

#### Scenario: Missing email

- **WHEN** a submission has no email value
- **THEN** the log carries `detail: 'missing_email'` with `outcome: 'failure'`.

#### Scenario: Rejected Turnstile

- **WHEN** the Turnstile siteverify call returns `success: false` for a form submission
- **THEN** the response is the verification-failed page (HTTP 403), and the log carries `detail: 'verification_failed'` with `outcome: 'failure'`.

#### Scenario: Missing secrets

- **WHEN** a required secret is unset
- **THEN** the log carries `detail: 'secrets_missing'` with `outcome: 'failure'`, alongside the existing `secrets_missing` event.

#### Scenario: Turnstile call error

- **WHEN** the Turnstile verification call fails to complete
- **THEN** the log carries `detail: 'verification_error'` with `outcome: 'failure'`, alongside the existing `turnstile_verify_error` event.

#### Scenario: Bot probes stay quiet

- **WHEN** a request serves static assets or a plain 404
- **THEN** no `invite_outcome` event is logged.

### Requirement: Log invite_outcome without personal data

`invite_outcome` events MUST NOT contain email addresses or other user-supplied personal data.

#### Scenario: Success event carries no PII

- **WHEN** an invite succeeds for any email address
- **THEN** the logged event holds only branch identity and Slack metadata, with no field carrying the submitted email value.
