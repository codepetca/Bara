# Pika–Bara attendance roadmap

## Goal

Deliver attendance as a native Pika experience powered by an independently
operable Bara attendance engine. A teacher or student signs into Pika once and
completes schedule-driven manual or QR attendance on Pika without entering the
Bara frontend or sharing database tables, browser sessions, or internal IDs.

## System boundary

- Pika owns classroom UX, courses, class days, rosters, calendar context, and
  the Pika copy of attendance results used by classroom workflows.
- Bara owns attendance execution: sessions, QR check-in, manual marking,
  corrections, operational failure states, and the auditable attendance ledger.
- WorkOS owns shared external identity. Pika and Bara are separate AuthKit
  Applications in the Codepet Platform project, with distinct clients,
  credentials, redirects, cookies, and token audiences. Codepet Labs remains a
  separate WorkOS project.
- Native Pika attendance does not create or depend on a Bara browser session.
  Pika derives the actor from its verified server session and sends a bounded
  principal assertion over the signed server-to-server adapter. Bara maps or
  narrowly provisions that identity into its own internal user model before
  authorizing the attendance operation.
- Pika and Bara keep separate internal users, authorization, and data stores.
  WorkOS subjects remain private to the application that authenticated them;
  the adapter carries only Pika-issued opaque principal references, never
  domain ownership IDs.
- Integration uses versioned HTTP/event contracts with explicit issuers,
  audiences, idempotency keys, and adapters. There are no cross-repository
  imports, shared database tables, or direct database access.

## Phase 1 — Bara attendance engine boundary (complete locally)

- Define provider-neutral lifecycle, mark/correction, and student check-in
  operations with explicit verified actor context.
- Keep standalone AuthKit and signed Pika request authentication outside the
  engine while preserving Bara's internal identity and roster-ownership model.
- Add controlled tenant-bound provisioning for Pika-only teachers and students;
  never permit arbitrary account creation or silent identity relinking.
- Add synchronous, versioned, idempotent student check-in with authoritative
  result states, immediate event dispatch, timeout/replay policy, retention,
  exact-time schedule jobs, and recovery sweeps.
- Prove standalone/integration rule equivalence and pass the complete Bara
  verification gate before changing Pika attendance behavior.

## Phase 2 — Versioned integration contract

- Completed first slice: closed byte-equivalent types/validators/signing in
  both repositories, plus a disabled Pika server client and Bara roster
  adapter with HMAC authentication, replay/idempotency/revision enforcement,
  and WorkOS-subject-to-Bara-owner resolution.
- Completed schedule slice: Pika can send concrete UTC occurrence windows;
  Bara materializes scheduled occurrences, preserves open/closed history,
  cancels removed future intent, and atomically queues privacy-safe lifecycle
  events.
- Completed lifecycle slice: authorized staff commands and Bara's minute-based
  scheduler invoke the same open/close attendance engine. Lifecycle events are
  delivered from a leased, retrying Convex outbox to Pika's durable Supabase
  inbox and monotonic projection, with the whole integration disabled by
  default.
- Completed record/recovery slice in code: bounded staff mark/correction
  commands update Bara's audited records, emit monotonic privacy-safe record
  events, and expose a signed authoritative snapshot that Pika can apply through
  a service-role-only reconciliation function.
- Define provider-neutral envelopes for Pika classroom/roster/schedule commands
  and Bara attendance/session events.
- Specify contract version, source, audience, occurred-at time, idempotency key,
  correlation ID, actor context, tenant mapping, retry policy, and failure codes.
- Treat Pika class days as scheduling intent. Bara remains authoritative for the
  actual attendance-session lifecycle and publishes what occurred.
- Define the minimum necessary student data, retention rules, reconciliation,
  deletion behavior, and contract-version coexistence.
- Prove the contract with fixtures and consumer/provider tests in both repos.
- The fixture-equivalent v1 implementation and the native Pika teacher surface
  are complete locally. The remaining Phase 2 gate is to apply the additive
  Pika migration in an isolated non-production database and prove a real
  disabled-then-enabled roster/schedule/session/mark/event/snapshot round trip.

## Phase 3 — Teacher attendance experience

- Completed locally: Attendance is a Pika classroom sidebar destination and
  renders a Daily-log-style student table in the main pane.
- Completed locally: the floating action area exposes QR, manual marking, bulk
  selection, corrections, and open/close controls through Pika-owned routes.
- Completed locally: configured Pika class days and the teacher's attendance
  window policy request automatic open/close while preserving explicit
  overrides and visible operational state.
- Completed locally: Bara-published lifecycle and record events project into
  the Pika Attendance page.
- Remaining gate: prove the complete state family against the isolated hosted
  target before enabling a pilot classroom.

## Phase 4 — Student QR attendance

- Completed locally: keep the browser on Pika and call Bara's `student_check_in` command from a
  Pika server route using only the actor from the verified Pika server session.
- Completed locally: resolve or narrowly provision the asserted external identity through Bara's
  `auth_identities`, then enforce roster and tenant authorization before writing
  attendance.
- Completed locally: publish the resulting attendance event to Pika and store the appropriate copy
  in both systems with source, actor, timestamps, and correction history.
- Completed locally: provide explicit unmatched, expired, closed, duplicate,
  successful, and uncertain/unavailable states.
- Remaining gate: prove these states with real linked and unmatched preview
  identities before enabling a pilot.

## Phase 5 — Pilot hardening

- Test tenant isolation, replay protection, retries, idempotency, clock skew,
  partial outages, schedule changes, and reconciliation.
- Complete accessibility and mobile-browser coverage for teacher and student
  flows, including school-board browser restrictions.
- Add structured operational logging, delivery visibility, alerting, recovery
  tools, CSV import/export reliability, and support procedures.
- Validate privacy, retention, deletion, audit, and breach-containment controls
  for both Pika and standalone Bara operation.

## Phase 6 — Production and standalone readiness

- Roll out development, preview, pilot, and production environments with
  environment-specific credentials, secrets, origins, callbacks, and rollback.
- Drill login, contract-version, event-replay, and attendance-data recovery.
- Keep Bara fully usable without Pika through its native roster/session UI.
- Add district SSO, provisioning, expanded RBAC, or institutional integrations
  only when required by a real deployment.

The Bara repository now has a guarded Vercel build that deploys Convex and
Next.js together, plus a privacy-safe rollout preflight. Hosted credentials,
the isolated Pika database target, real cross-app smoke, and promotion remain
operator gates; no production release is implied by the local implementation.

## Release principle

No phase may redirect or embed the Bara frontend for native Pika attendance.
If Pika cannot authenticate the user or the signed Bara command cannot return a
definitive result, Pika reports attendance as unavailable or uncertain and uses
the same idempotency key for an explicit retry; it never presents a second login
or claims a delayed student scan succeeded.

The canonical product flows, data ownership, WorkOS decision, security gates,
and seven-phase rollout are mirrored in Pika at
`docs/integrations/pika-bara-native-attendance-roadmap.md`.
