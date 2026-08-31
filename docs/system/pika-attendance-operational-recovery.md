# Pika attendance operational recovery

This runbook does not authorize deployment, flag changes, or hosted recovery.

## Missing tenant connection recovery

Treat `pika_installation_tenants` as durable workspace ownership, not a disposable
attendance ledger. Any cleanup that retains an organization, its users, or its
memberships must retain this connection and tenant recovery audits. An empty
attendance graph alone is not a healthy reset. Never empty every `pika_*` table
by prefix. Inventory the ownership graph, approve exact targets, and preserve a
restricted backup before any destructive operation.

The internal-only `pikaTenantRecovery:inspect` and `pikaTenantRecovery:restore`
functions prepare and perform a **single missing-link** repair. Neither is
reachable through a public function or HTTP endpoint, and both are disabled by
default. They never create organizations or users, change memberships, clear
ledgers, send messages, or schedule attendance.

Operator procedure (each hosted change needs explicit target-specific approval):

1. Establish the exact deployment, installation, tenant, and organization using
   authoritative configuration and retained/historical ownership evidence.
   Installation membership corroborates installation ownership; it does **not**
   establish the deleted tenant association by itself. If tenant evidence is
   missing, obtain an explicit owner decision before proceeding. An organization
   name or deterministic slug is never sufficient authorization.
2. Inventory queued Pika roster/schedule deliveries before repairing the link;
   ordinary retries may resume immediately once it is restored. Establish an
   approved current/future recovery scope, and obtain explicit pause/resume
   approval if old snapshots could otherwise replay. Do not silently disable
   unrelated classrooms. Capture a restricted pre-repair backup of the relevant organization, users,
   identities, memberships, connections, and existing recovery audits. Record an
   opaque backup reference and verified evidence reference; do not put names,
   email addresses, tokens, or backup credentials in the function arguments.
3. After reviewing and deploying the repair code, explicitly approve and set
   `PIKA_TENANT_RECOVERY_SCOPE` to a JSON object containing exactly
   `installationRef`, `tenantRef`, and `organizationId`. The installation must
   match the runtime's `PIKA_INTEGRATION_REF`. This is a temporary operator
   assertion of a verified scope, **not** automatic ownership discovery.
4. Call `inspect` with that exact scope. It requires an active organization, no
   existing connection in either direction, 1–100 active unique memberships with
   retained active users, at least one staff/admin, and one matching Pika identity
   per member. Oversized or ambiguous evidence fails closed. It returns a digest
   and counts, not personal data, and writes nothing. Keep that result with the
   approval and backup evidence.
5. Call `restore` with the same scope and `planDigest`, plus opaque `requestId`,
   `operatorRef`, `reasonCode`, `evidenceRef`, and `backupRef`. The mutation
   rechecks the evidence, rejects drift, and inserts only the connection and
   append-only audit in one transaction. The references attest to operator
   verification; the function does not fetch or validate external backups.
6. On an uncertain response, retry the exact same arguments and request ID.
   A matching audit returns the original result only if the connection still
   matches. Conflicting requests and a disappeared connection fail closed.
7. Verify both mapping directions and unchanged retained data, then remove the
   temporary scope gate. Inspect current/future delivery state and use separately
   approved supported retries/reconciliation; never clear idempotency ledgers or
   change immutable message payloads to force acceptance.

### Privileged operator invocation

Use the authenticated Convex project-admin CLI, not the browser client or Pika
HTTP API. Convex explicitly supports running internal functions from its
[CLI and dashboard](https://docs.convex.dev/functions/internal-functions).
The installed CLI uses deployment admin authentication for `convex run`; this
does not require publishing a recovery endpoint or adding an internal caller.

After the approved code is already deployed, verify the linked project and its
default production deployment against the approved target. The following are
command templates, **not authorization to execute them**. Replace the JSON
placeholders with the reviewed scope and metadata; never paste credentials or
personal data into arguments. Do not add `--push`, which would combine an
unreviewed deployment with execution. See the [CLI reference](https://docs.convex.dev/cli/reference/run).

```sh
pnpm exec convex env get --prod PIKA_INTEGRATION_REF
pnpm exec convex env set --prod PIKA_TENANT_RECOVERY_SCOPE '<approved-scope-json>'
pnpm exec convex run --prod --codegen disable pikaTenantRecovery:inspect '<approved-scope-json>'
pnpm exec convex run --prod --codegen disable pikaTenantRecovery:restore '<approved-scope-plus-digest-and-audit-json>'
pnpm exec convex env remove --prod PIKA_TENANT_RECOVERY_SCOPE
```

The scope JSON contains exactly `installationRef`, `tenantRef`, and
`organizationId`. The restore JSON additionally contains `planDigest`,
`requestId`, `operatorRef`, `reasonCode`, `evidenceRef`, and `backupRef`. Reuse the
identical restore JSON on an uncertain response. Run the mutation only after
reviewing the inspect result against the approved backup/evidence; removing the
gate does not undo a repair. These templates have not been executed in production.

Failure before commit leaves no partial mapping or audit. If post-repair
verification detects an unexpected state, stop new recovery actions and obtain
a scoped rollback decision. Once ordinary delivery has produced new rosters or
attendance state, deleting the link is not a safe rollback. Do not restore a
whole-database backup over unrelated concurrent work.

Release acceptance must exercise new-classroom provisioning and scheduling,
automatic opening on an eligible class day, the student notice, and an
authorized test check-in. Verify a second classroom remains unchanged. The
credential smoke below does not establish these behaviors.

## Bidirectional credential gate

Bara exposes `/api/integrations/pika/v1/smoke` only through the normal Pika HMAC
authentication boundary with a one-use nonce and a five-attempt/15-minute
installation limit. The endpoint is allowed while the attendance integration
flag is false, but it accepts only the closed smoke envelope and cannot invoke
roster, schedule, session, mark, check-in, event, or projection behavior.
The signed request body also names `pre-enable` or `enabled`; Bara requires
that mode to match its own runtime flag before consuming a smoke nonce.

After authenticating Pika, deployed Bara derives the callback from the fixed
`PIKA_EVENT_DELIVERY_URL` origin and signs the fixed Pika smoke-ingress path with
the separate event-delivery secret. Pika independently binds the opaque scope
digest to its configured installation, tenant, plus exact teacher/classroom canary and
checks current classroom ownership and accepts the callback only for the
active run's five-minute challenge. Bara returns only two booleans. It never
receives Pika UUIDs, compares secrets, or exposes diagnostics.
Production event and smoke delivery reject any configured HTTPS origin other
than the reviewed `https://pika.codepet.ca`, reject redirects, and validate the
callback before consuming smoke state; loopback HTTP remains local-only.

The guarded Bara Vercel production build audits Vercel-owned deployment and
WorkOS configuration. Attendance transport values live in the Convex runtime,
so the signed deployed smoke—not a Vercel environment download or build-time
self-comparison—is their authoritative gate. `vercel env pull/run` redacts
Sensitive values, so a downloaded-environment audit remains advisory.
The local shape check remains:

```bash
pnpm check:rollout -- \
  --mode pre-enable \
  --stage production \
  --expected-bara-origin "https://bara.example" \
  --expected-pika-origin "https://pika.example"
```

The corresponding Pika runbook owns the operator-protected deployed invocation.
Preview has no staging database: record a production-only skip and do not call
production. A skip, mismatch, replay, rate limit, or either failed direction
blocks enablement and expansion.

## Failed event recovery

`pikaOutboxRecovery:recoverFailedEvents` is an internal Convex mutation. It has
no client or public HTTP exposure. It accepts only the configured installation,
fixed credential error codes (`http_401`, `http_403`), 1–50 rows, at most 20
delivery attempts, and at most three recovery attempts. A unique opaque request
ID makes reruns idempotent and an append-only audit records opaque operator and
reason references, bounds, and aggregate dispositions.
Reusing a request ID with different operator, reason, or bounds is rejected;
audit and delivery timestamps are derived by the Convex runtime.
Each bounded page accepts an opaque audited cursor and returns `nextCursor` plus
`isDone`; operators use a fresh request ID with the returned cursor until done,
so unchanged ineligible rows cannot starve later eligible failures.

For each failed event, Bara validates the immutable stored event, binds its
event ID, type, correlation, installation, and roster back to the stored row
and occurrence mapping, and compares its session or record revision to the same
authoritative state returned by snapshot reconciliation. Current events return to `pending`; older events become
terminal `superseded`; malformed, future, unmapped, ineligible, or exhausted
events remain unchanged. Recovery never edits event IDs or payloads and never
sends HTTP itself.

The nine known pre-repair failures remain hosted and untouched. Snapshot
reconciliation restored current state, so do not run recovery against them
without fresh authorization naming the production deployment, installation,
bounds, request ID, and opaque operator/reason references. Inspect aggregate
results before allowing the normal delivery worker to run.
