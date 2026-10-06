# Email system evaluation — October 6, 2026

## Result

Both production sending paths reached Zoho CPaaS successfully, but neither test
reached the approved recipient, `jhodge@peterisland.net`. Zoho records a hard
bounce for both with the same recipient-system response:

> #5.7.1 Your access to submit messages to this e-mail system has been rejected.

This establishes a failure after provider acceptance. It does not establish which
recipient policy caused the rejection. Recipient gateway tracking is needed to
distinguish sender reputation, domain policy, authentication, and other controls.

## Live evidence

Times below are Atlantic Standard Time (UTC−04:00).

| Test | Sender | Submitted | Provider result |
| --- | --- | --- | --- |
| Production password recovery form | `noreply@fixxflow.app` via SMTP | 1:08:06 PM | Hard bounce, `5.7.1` |
| Ticket #1001 assignment notification | `notifications@fixxflow.app` via API | 1:10:48 PM | Hard bounce at 1:10:52 PM, `5.7.1` |

- Supabase Auth logs record `/recover`, HTTP 200, and `user_recovery_requested`.
- Test ticket: `5d85fb4a-1974-44b0-9fa3-014e7f0ba741`.
- Closed through the authenticated app after evaluation; one notification remains
  as evidence and no pending/sending email remains for the ticket.
- Notification: `962cdcc3-2b3a-4443-988b-991f29abb98a`.
- Queue state: `sent`, one attempt, provider ID present, no queue error.
- Zoho notification request ID:
  `2d6f.1fa3bc90069e1389.m1.dffdba52-c1a8-11f1-871e-5254005934b4.1a112324a73`.
- Zoho recovery request ID:
  `2d6f.1fa3bc90069e1389.s1.7f75d051-c1a8-11f1-81c0-525400cbcb5e.1a1122fd1d0`.
- Zoho shows the sending domain, DKIM selector, and bounce CNAME as verified.
- Production Administration reports Zoho configured. That indicator checks
  configuration, not delivery health.

The queue's `sent` state means the provider accepted the message. It does not
track later bounces or prove inbox receipt. Provider event reconciliation is a
future implementation consideration, not part of this test change.

Public MX lookup through `1.1.1.1` returned:

```text
10 mx1.hc6813-64.iphmx.com.
20 mx2.hc6813-64.iphmx.com.
```

These match [Cisco Secure Email Cloud Gateway MX conventions](https://docs.ces.cisco.com/docs/review-and-validate-mx-records).
The gateway identification is inferred from DNS; its internal policy was not
inspected. The request-triggered IP in Zoho is the app/SMTP caller's IP, not proof
of the outbound Zoho delivery IP, and must not be used as an allowlist target.

## Automated verification

Added eight tests covering an empty queue, partial provider failure with sanitized
retry acknowledgement, SLA/claim database failures, unsuccessful acknowledgement,
network/timeout/malformed provider responses, and chat/fallback deep links.

| Check | Result |
| --- | --- |
| Email tests | 18 passed |
| Full `npm test` | 757 passed, zero failures/skips |
| Database event suite, including notification regression SQL | 35 passed |
| Administration tests, including email readiness | 7 passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |

Local tests ran against the current checkout, based on `df0f386`. At evaluation
time, `origin/main` was three commits ahead at `5bfda6b`, including a template
redesign. Live evidence evaluates the deployed production behavior separately;
local template tests should not be mistaken for deployment parity.

## Content and remaining checks

Zoho's notification preview showed a purpose label, clear event heading, update
button, fallback URL, sign-in note, and support link. Its action and fallback URL
both targeted the correct production ticket. Conversation bodies were absent.
The logo did not appear in the provider preview; its public PNG fetched
successfully. Actual inbox image rendering remains unverified.

Template tests check HTML escaping, English document language, presentation
tables, branding alt text, and preserved Supabase action/code placeholders. These
do not replace mobile, screen-reader, dark-mode, Outlook, or Gmail rendering tests.
No UI, shared token, or template changes were made in this evaluation.

Next: have the Peter Island mail administrator inspect inbound tracking for the
two test timestamps and sender addresses, retrieve the outbound Zoho delivery IP
and exact policy reason, and resolve the applicable policy through the normal mail
administration process. Then repeat both paths and verify inbox placement,
rendering, and the notification link. No further retries were initiated after the
hard bounces, and no mail security settings were changed.
