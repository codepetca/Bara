# WorkOS Magic Auth delivery through Brevo

Status: implementation in progress; external delivery remains disabled until the
rollout gates below are approved and passed.

- User goal: receive exactly one reliable Magic Auth message while keeping Pika
  and Bara as separate WorkOS Applications and preserving standalone Bara login.
- UX flow: Pika continues to send the WorkOS-generated code directly through
  Brevo. For standalone Bara login, WorkOS emits `magic_auth.created`; Bara
  verifies the signed event, retrieves the code from WorkOS, and sends one Bara
  message through Brevo.
- Architecture plan: add a Bara-owned Convex webhook, durable idempotent outbox,
  and retrying delivery action. Route only the Bara WorkOS client ID, ignore the
  Pika client ID, retain no email address or code in the outbox, and use one
  stable Brevo idempotency key per WorkOS event.
- Identity boundary: email delivery does not create or exchange sessions. Bara
  Hosted UI still creates the Bara session; native Pika attendance continues to
  use Pika's session and the existing signed server-to-server actor assertion.
- Failure behavior: invalid signatures fail closed; duplicate events are
  acknowledged without another send; expired challenges are discarded; failed
  sends retry only while the challenge and Brevo idempotency window are safe.
- Simplification: implement only Magic Auth delivery. Do not add a generic mail
  bus, change Pika, combine WorkOS Applications, or alter authentication and
  attendance identity models.
- Acceptance: automated tests cover signature rejection, client filtering,
  event deduplication, retries, expiration, and Brevo idempotency; staging then
  proves exactly one message per Pika challenge and per standalone Bara
  challenge before WorkOS default Magic Auth delivery is disabled.
- Rollback: re-enable WorkOS default Magic Auth delivery first, then disable the
  Bara custom-delivery feature flag. Code and webhook registration can remain
  dormant while the incident is reviewed.
