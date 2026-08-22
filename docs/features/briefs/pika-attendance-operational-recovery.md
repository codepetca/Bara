# Pika attendance operational recovery

- User goal: recover credential-caused Bara-to-Pika event failures safely after
  configuration repair, without replaying stale attendance or widening the
  single-installation boundary.
- Operator flow: run a bounded internal recovery mutation for the configured
  installation; eligible current events return to `pending`, while events whose
  revisions are older than Bara's authoritative occurrence or record state are
  terminally marked `superseded`; inspect the aggregate audit result before the
  normal delivery worker runs.
- Architecture: extend `pika_outbox` with a `superseded` disposition and bounded
  recovery metadata, add an append-only recovery audit table, and implement an
  internal-only mutation plus focused Convex tests. Add a signed smoke endpoint
  that authenticates Pika, consumes a replay nonce, calls Pika's separately
  signed smoke ingress, and returns aggregate checks only.
- Recovery invariants: exact configured installation only; failed rows only;
  fixed eligible credential error codes; per-event delivery and recovery attempt
  caps; bounded batch size; no payload/event-id mutation; idempotent reruns;
  revision comparison against current authoritative Bara state; append-only
  operator/reason/count audit; no client/public recovery function.
- Smoke invariants: separate directional secrets; no secret comparison or secret
  output; exact installation and canary binding; timestamp and one-use nonce in
  each direction; fixed callback URL; bounded body/time/rate; no roster, session,
  record, event, or projection mutation; aggregate no-store response.
- Risks: incorrectly replaying stale events, installation escape, unbounded
  retries, audit data leakage, replay, SSRF, and enabling attendance before both
  deployed credential pairs are proven.
- Simplification: no recovery UI, arbitrary event selector, payload editor,
  production data operation, or general multi-installation administration.
- Acceptance: tests prove requeue, supersede, ineligible/exhausted rejection,
  bounds, audit/idempotency, tenant isolation, directional auth mismatch,
  replay rejection, and zero attendance-domain writes during smoke.
