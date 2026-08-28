# Pika attendance contract v1

- User goal: let teachers configure Attendance timing in Pika while Bara remains
  the authority for whether a QR scan is accepted and when it occurred.
- UX flow: teachers configure session and cutoff times in Pika. Pika sends Bara
  concrete `[accepts_at, stops_accepting_at)` gates; students scan while that
  gate is open; Pika derives Present, Late, Absent, or Unmarked from Bara's
  immutable timestamp facts and teacher overrides.
- Primary action: accept an eligible student scan exactly once and return its
  server-authoritative timestamp without assigning a Pika attendance status.
- Architecture plan: keep dependency-free v1 types and validators byte-matched
  between repositories; store Pika check-ins in a dedicated append-only fact
  ledger; publish monotonic accepted/invalidated events and snapshots; keep
  Pika status policy, automatic derivation, override history, and Undo outside
  Bara. Standalone Bara attendance stays independent.
- Risks: accepting scans outside the half-open gate, losing accepted facts,
  treating invalidation as deletion, reordering revisions, tenant escape,
  accidental PII or internal-ID expansion, and contract-copy drift.
- Simplification: this is a coordinated pre-release v1 replacement. Do not add
  legacy status commands, dual-read compatibility, or Pika status fields to
  Bara. Existing accepted facts survive later policy edits; invalidation is an
  audited event and permits a new scan only while the QR gate remains open.
- Acceptance: both contract copies remain byte-equivalent; signed requests
  reject stale, replayed, or tampered input; the server clock controls
  `accepted_at`; opening is inclusive and stopping is exclusive; idempotency and
  revision ordering are enforced; reconciliation recovers current facts; no
  Bara internal IDs appear in HTTP responses; and the full Convex test,
  typecheck, lint, and build gates pass.
