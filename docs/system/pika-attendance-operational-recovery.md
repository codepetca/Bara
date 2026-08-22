# Pika attendance operational recovery

This runbook does not authorize deployment, flag changes, or hosted recovery.

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
than the reviewed `https://pika.codepet.ca`; loopback HTTP remains local-only.

The guarded Bara Vercel production build audits deployment configuration with
the actual Sensitive values. `vercel env pull/run` redacts those values, so a
downloaded-environment audit is advisory and cannot satisfy the hosted gate.
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
