# Bara attendance engine boundary

- User goal: keep standalone Bara independently useful while making Bara's
  authoritative attendance engine available to native Pika attendance through
  a versioned server-to-server adapter and one Pika login.
- UX flow: standalone users continue through Bara's native UI. Pika teachers
  and students stay on Pika; Pika authorizes them, calls Bara server-to-server,
  renders Bara's synchronous result, and reconciles its monotonic projection
  from Bara events and snapshots.
- Primary action: invoke one provider-neutral attendance operation with an
  explicit verified actor context, regardless of which adapter initiated it.
- Architecture plan: extract lifecycle, mark/correction, and student check-in
  operations inside the existing Convex application; keep AuthKit and signed
  Pika request handling in adapters; split Pika transport, installation,
  identity, mapping, command, and event concerns where that clarifies the
  boundary. Preserve `app_users` + `auth_identities`, roster ownership through
  `rosters.ownerAppUserId`, Convex authority, and opaque integration refs. Pika
  asserts installation-scoped opaque principals rather than exporting WorkOS
  subjects; Bara stores them under a separate `pika` identity provider.
- Risks: adapter rule drift, arbitrary provisioning or identity relinking,
  tenant confusion, lost responses, stale idempotency records, delayed scans,
  schedule timing gaps, unsafe lifecycle changes while disabled, event identity
  collisions, event reordering, and accidental internal-ID exposure.
- Simplification: keep one application and one Convex store; do not add another
  service, repository, browser handoff, shared session, or cross-database path.
  Defer Pika changes until the Bara boundary and equivalence tests pass.
- Acceptance: standalone and Pika adapters call the same domain operations;
  controlled tenant-bound provisioning cannot relink identities; v1
  `student_check_in` is idempotent and returns authoritative closed results and
  changed revisions synchronously; event delivery has immediate dispatch plus
  recovery; exact-time jobs have a recovery sweep; retention and uncertain
  outcomes are documented and tested; the full Bara test/type/build gates pass
  before any Pika implementation begins.

## Implemented Bara boundary

- `convex/attendanceEngine.ts` owns provider-neutral lifecycle, marks,
  corrections, and student check-in with explicit verified actor context.
- Standalone AuthKit/shared-token mutations and the signed Pika adapter call
  that engine; equivalence tests compare both verified actor sources.
- Installation/tenant mapping and controlled staff/student provisioning are
  isolated from request authentication and attendance rules. Pika principals
  cannot collide with standalone WorkOS identities or silently reuse a Bara
  organization.
- `student_check_in` returns the authoritative record/session revision in the
  response, stores its closed result for replay, and queues a privacy-safe event
  in the same transaction when the record changes.
- Exact occurrence jobs, the recovery sweep, immediate outbox dispatch, leased
  retry recovery, and bounded replay/idempotency cleanup are present locally.
  Disabled automation records a per-occurrence pause without opening or
  finalizing attendance; paused occurrences require an explicit staff command.
- Review-needed participant links fail closed for student check-in. Event IDs
  digest the complete logical input, and normal classroom-sized outbox batches
  drain immediately before the cron is needed.
