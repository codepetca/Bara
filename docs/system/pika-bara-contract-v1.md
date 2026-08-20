# Pika–Bara attendance contract v1

Status: Phase 2 implementation complete locally; hosted proof pending. The closed validators, request signing, Pika
server client, Bara roster HTTP adapter, identity-resolved roster mapping,
materialized schedule storage, atomic schedule event outbox, revision checks,
nonce replay protection, and idempotency are implemented but remain disabled
by default. Manual and scheduled open/close use the same Bara attendance
engine, and the leased outbox delivers signed events to Pika's transactional
inbox/projections. Bounded mark/correction commands, record-change events, and
signed reconciliation snapshots and native Pika teacher surface are implemented
in code. Phase 2 still needs the additive Pika migration applied to an isolated
non-production target and a real cross-app round trip before it is considered
complete.

## Boundary

Pika owns academic intent: classrooms, enrolment, class days, the teacher's
attendance-window policy, and the Pika-side attendance projection. Bara owns
attendance execution: scheduled occurrences, open/close lifecycle, check-in
tokens, manual marks and corrections, authoritative attendance records, and
the audit event stream.

Neither application imports the other repository, queries the other database,
or treats the other application's IDs as domain IDs. Pika calls a versioned
Bara HTTP adapter. That adapter calls app-facing Bara domain functions; Pika
never calls Convex directly. A future Bara datastore or runtime replacement
therefore stays behind the same contract.

| Concern | Authority | Replica or consumer |
| --- | --- | --- |
| Classroom and class days | Pika | Bara receives concrete future occurrences |
| Roster membership and display names | Pika for integrated classrooms | Bara keeps an operational roster copy |
| Scheduled/open/closed attendance session | Bara | Pika keeps a read projection |
| Attendance mark and correction history | Bara | Pika keeps the latest projection and received events |
| External identity | WorkOS | Each app maps it to its own internal user |
| Roles and authorization | Each app independently | Never copied as domain ownership |

Standalone Bara uses its native roster and scheduling adapters to invoke the
same attendance domain operations. Pika is one adapter, not a privileged data
model.

## Schedule materialization

Pika currently has explicit class dates but no class start/end time. A date
alone cannot safely determine when attendance opens or closes. Before automatic
operation is enabled, Pika must add one teacher-owned attendance-window policy
per classroom (timezone, local start time, local close time, with future room
for weekday/date overrides).

Pika combines that policy with `class_days` and sends concrete UTC occurrence
windows. Bara does not calculate Pika timetables or read the Pika database.
Pika refreshes a rolling future horizon after schedule changes and during daily
reconciliation. Bara's scheduler idempotently opens and closes due occurrences
and publishes what actually happened.

Future schedule revisions may replace or cancel sessions that have not opened.
They never rewrite an open or closed session. Historical corrections remain
explicit attendance events.

## Identity and privacy

- Pika generates random, installation-scoped `roster_ref`, `participant_ref`,
  and `occurrence_ref` values and stores their local mappings. Raw Supabase IDs
  are never transmitted.
- Bara stores those references only in integration-mapping records. It never
  uses them as Convex IDs or ownership IDs.
- Every integrated roster snapshot carries an installation-scoped `tenant_ref`
  plus a Pika-issued opaque `principal_ref` and bounded display name for its
  owning staff user. WorkOS subjects stay inside the application that verified
  them. Bara maps the installation-scoped principal into a minimal tenant-bound
  `app_users` + `auth_identities` record with `staff` membership; it never
  creates an integration administrator or silently adopts a standalone Bara
  organization. `rosters.ownerAppUserId` remains the domain owner.
- Display name is intentionally duplicated because staff need it to operate
  and review attendance in both products. It is personal data and receives the
  same access, retention, deletion, backup, and audit protections as native
  Bara roster data.
- Integrated roster sync omits school email by default. When a student has a
  verified Pika session, Pika may include an opaque principal assertion. Bara
  resolves or minimally provisions a `student` membership inside the mapped
  tenant before linking the participant. An existing identity is never moved
  to another app user, an existing participant is never silently relinked, and
  a role conflict becomes review-needed rather than an implicit role change.
- A participant without an identity assertion remains roster-only and can be
  marked manually. A failed or ambiguous identity link requires review; it does
  not guess by name.
- HTTPS protects transfer. Pseudonymous references minimize correlation, but
  they do not make names anonymous. Application-layer encryption is not a
  substitute for tenant authorization and is deferred unless a customer threat
  model requires it.

## HTTP surface

All calls use HTTPS, an installation-scoped server credential, an idempotency
key for writes, bounded closed JSON, and exact origin allow-lists. Credentials
never reach the browser. Pika authenticates its teacher or student first and
derives the actor exclusively from the verified Pika server session; for a user
action its server includes the bounded external principal assertion. Bara maps
or narrowly provisions that identity inside the installation's tenant context
and independently checks roster access. Client-supplied identity fields are
never forwarded as actor assertions.

The pilot transport signs the exact raw body plus method, path, Unix-second
timestamp, and a random nonce with HMAC-SHA-256. The request uses
`X-Attendance-Installation-Ref`, `X-Attendance-Timestamp`,
`X-Attendance-Nonce`, and `X-Attendance-Signature`. Bara accepts at most five
minutes of clock skew and durably rejects nonce replay. The idempotency key is
separate: a legitimate retry uses a new nonce and receives the stored result
only when its body digest matches.

The first pilot configuration supports one Pika installation per Bara
environment. Expanding to multiple installations requires a credential
registry and rotation workflow; it must not become an environment JSON blob or
a shared global secret.

Proposed Bara routes:

- `PUT /api/integrations/pika/v1/rosters/{roster_ref}` — monotonic desired-state
  roster snapshot with an owner identity assertion, display names, active
  state, and optional participant identity-link assertions.
- `PUT /api/integrations/pika/v1/schedules/{roster_ref}` — monotonic snapshot of
  concrete future occurrence windows for a bounded date range.
- `POST /api/integrations/pika/v1/sessions/{occurrence_ref}/commands` — explicit
  staff `open` or `close` command. Automatic open/close invokes the same Bara
  domain operation with a system actor.
- `POST /api/integrations/pika/v1/sessions/{occurrence_ref}/marks` — bounded
  batch of manual marks or corrections with one idempotency key per command.
- `GET /api/integrations/pika/v1/sessions/{occurrence_ref}` — authoritative
  snapshot for reconciliation.
- `POST /api/integrations/pika/v1/sessions/{occurrence_ref}/check-in` — current
  QR/check-in presentation for an authorized staff actor. The signed closed
  body carries the occurrence reference and Pika's installation-scoped opaque
  `actor_principal_ref`; Pika verifies WorkOS locally before resolving that ref. The
  response contains only the contract version, occurrence reference, session
  revision, exact `/check-in/{token}` path, and expiry.
- `POST /api/integrations/pika/v1/sessions/{occurrence_ref}/student-check-ins`
  — idempotent student check-in using the asserted principal from Pika's
  verified server session. The synchronous closed response is authoritative and
  includes the result code plus changed record/session revisions when applied;
  a retry after a timeout reuses the same idempotency key with a fresh nonce.

Staff commands carry the installation-scoped opaque `actor_principal_ref` and
bounded display name. Bara never receives the Pika WorkOS subject. A
Pika-only teacher may be provisioned only as tenant-bound `staff` with access to
the asserted roster. Student commands carry the same bounded assertion shape;
the Pika server must derive it exclusively from its verified session.

## Timeouts, replay, and retention

- A response received from Bara is authoritative. Pika renders it immediately
  and then reconciles its projection from events or a snapshot.
- A connection loss or timeout after sending a command is an uncertain outcome,
  not a failure. Pika retries the exact body with the same idempotency key and a
  fresh request nonce. A different body under that key returns `409`.
- Student scans are never placed on a delayed client or server queue. Until a
  definitive response or safe replay is received, Pika must not claim success.
- Signed request nonces are retained for 24 hours. Command idempotency results
  are retained for 30 days. A bounded daily cleanup continues in scheduled
  batches until all expired rows are removed.
- The signature timestamp still permits at most five minutes of clock skew;
  retention is defense-in-depth and does not widen that authentication window.

The first implementation must use pure, dependency-light v1 types and closed
validators outside Convex. Bara is the contract source of truth; Pika vendors a
reviewed copy plus identical valid/invalid fixtures, following the proven Pal
contract pattern. The contract package contains no Convex or Supabase types.

The roster adapter response contains only outcome, `roster_ref`, revision, and
aggregate created/updated/deactivated counts. Pika rejects extra response
fields, which prevents an accidental Convex ID from entering its datastore or
logs.

Schedule snapshots create separate Bara occurrence plans rather than widening
the existing live-session table. A scheduled occurrence can be revised or
cancelled; once open or closed it is historical and a later desired-state
snapshot preserves it. Each scheduled/revised/cancelled transition writes a
closed v1 event to the Pika outbox in the same Convex transaction.

## Bara event stream

Bara writes an outbound event in the same authoritative operation that changes
session or attendance state and schedules an immediate delivery attempt after
commit. The leased cron remains recovery for timeouts, process interruption,
and backlog. Delivery is at least once. Pika acknowledges only
after its inbox row and projection update commit in one Supabase transaction.
Bara retries network, timeout, `408`, `429`, and `5xx` failures with leases and
backoff; closed-contract `4xx` responses are retained for operator review.

The closed v1 envelope is:

```json
{
  "schema_version": 1,
  "event_id": "opaque-event-ref",
  "idempotency_key": "opaque-stable-key",
  "correlation_ref": "opaque-operation-ref",
  "event_type": "attendance.record.changed",
  "occurred_at": "2026-08-16T14:05:00Z",
  "installation_ref": "opaque-installation-ref",
  "roster_ref": "opaque-roster-ref",
  "occurrence_ref": "opaque-occurrence-ref",
  "session_revision": 4,
  "metadata": {}
}
```

Initial event types:

- `attendance.session.scheduled`
- `attendance.session.opened`
- `attendance.session.closed`
- `attendance.session.cancelled`
- `attendance.record.changed`

Record-change metadata contains only `participant_ref`, `record_revision`,
`from_status`, `to_status`, `source`, `actor_type`, and a bounded reason code.
It does not contain names, emails, internal IDs, tokens, free-form notes, or
provider responses. Pika already owns the roster display data.

Session and record revisions make duplicate and out-of-order delivery safe.
Pika periodically requests authoritative session snapshots so a missed webhook
cannot leave the projection permanently stale. Bara periodically compares its
outbox acknowledgements and exposes privacy-safe backlog health.

Each occurrence schedules exact open and close jobs at its authoritative UTC
instants. The minute-based sweep invokes the same lifecycle engine as recovery
for missed jobs, deploy gaps, or transient failures. Schedule revisions add new
exact jobs; stale jobs are harmless because lifecycle status, revision, and due
time are rechecked transactionally.

The reconciliation snapshot is a closed response containing only the
occurrence/roster references, lifecycle revision and window, plus marked or
corrected participant references with record revision, status, source, actor
type, and modified time. Pika applies it through a service-role-only monotonic
Supabase function; it does not create synthetic inbox events or receive Bara
internal IDs.

## Browser journeys

Pika renders the native Attendance tab and calls only Pika routes. Those routes
authorize the Pika user, invoke the server-side Bara adapter, and return closed
view models. The browser never receives integration credentials or Convex IDs.

The teacher QR encodes Pika's public `/attendance/check-in/{token}` entry, not a
direct service URL. A signed-out student completes Pika login and returns to
that Pika entry. Pika's server derives the actor from its verified session,
calls Bara's versioned `student_check_in` command with the scanned opaque
check-in token and a stable idempotency key,
and renders the authoritative closed result on Pika. The browser is never
redirected to or embedded in the Bara frontend, and native Pika attendance does
not depend on a Bara AuthKit session. A fallback Bara Hosted UI prompt is not an
acceptable substitute.

## Versioning and rollout

- A version is immutable once deployed. Additive optional fields require both
  validators to accept them before a producer emits them.
- Breaking shape, meaning, identity, or authorization changes create `v2`
  routes and types. V1 and v2 run side by side during migration.
- Every write records contract version, installation, idempotency key, and
  applied resource revision for audit and replay safety.
- Feature flags independently gate roster sync, schedule sync, teacher
  commands, event ingestion, and student QR. A partial rollout cannot silently
  fall back to direct database coupling or a second login.

Phase 2 is complete only when both repositories share fixture-equivalent v1
validators, request authentication and replay tests pass, duplicate and
out-of-order event tests pass, a local roster/schedule/session round trip is
proven, and disabling the adapter leaves standalone Bara and existing Pika
attendance unchanged.
