# Pika attendance contract v1

- User goal: keep Pika and Bara independently replaceable while teachers use
  attendance as one Pika workflow.
- UX flow: no new screen in this slice; later Pika UI calls its own server,
  which exchanges only validated v1 messages with Bara.
- Primary action: establish the closed machine boundary before adding schema,
  transport, or UI behavior.
- Architecture plan: dependency-free v1 types, validators, and signing helpers
  in Bara; a reviewed vendored copy in Pika; identical behavioral tests; then a
  signed Bara HTTP wrapper around app-owned Convex mapping/idempotency tables.
  Keep the outbox in the main Convex transaction boundary so an attendance
  write and its event can later commit atomically.
- Risks: accidental PII or internal-ID expansion, incompatible copies, ambiguous
  schedule times, replay/ordering bugs, and provider types leaking into the
  public contract.
- Delivery sequence: prove transport authentication and an idempotent roster
  snapshot round trip first, then schedule/session lifecycle and durable event
  delivery. Keep QR resume and UI deferred until that ownership boundary and
  the record/reconciliation paths are proven.
- Acceptance: both copies remain byte-equivalent; signed requests reject stale,
  replayed, or tampered input; roster ownership resolves the asserted opaque
  Pika principal to a Bara `app_user`; revisions and idempotency are enforced;
  no Bara internal IDs appear in the HTTP response; and focused Convex/HTTP
  tests pass.
