# Coordinated Pika classroom deletion

Owner: Audit Pika security and privacy; branch `codex/coordinated-classroom-deletion`
in each repository. Pika base `e5d746b3`; Bara base `cc03e72`.

## Goal and flow

An owning teacher can permanently remove an archived classroom without leaving
its operational attendance copy in Bara. Unlinking is not deletion. Pika first
installs a durable database fence, then requests remote deletion, verifies the
exact operation's absence receipt, and only then removes its attendance state
and invokes the existing guarded classroom purge. Shared users, identities,
organizations, memberships, other classrooms, and Blueprints survive.

## Implementation

- Add a separately namespaced, signed `roster.decommission` v1 contract with
  begin/tick/status actions and an immutable operation reference.
- Bara atomically fences an exact installation/roster, rejects old and new
  commands before idempotent success, and blocks native writes and automation.
- Explicit signed ticks delete bounded batches of the owned graph. There is no
  new recurring scheduler. Retry uses the same operation; partial work stays
  fenced. Pending, failed, delivered, and superseded outbox payloads and cached
  results are in scope. Pre-existing rows require no unsafe inferred backfill.
- Keep only an opaque scope/operation tombstone and aggregate progress after
  verified deletion, to prevent delayed snapshots from recreating the roster.
- Pika's consumer rejects wrong-scope, wrong-operation, or incomplete receipts.
  Follow with its durable Supabase coordinator and the existing purge lifecycle.

## Risk and rollout

High-risk destructive workflow / runtime-platform risk. Disabled by default in
both apps; no UI changes in the provider/contract slice. A fence never depends
on the rollout flag staying enabled. No hosted deploy, flag changes, migration
application, or real/synthetic production erasure is authorized by this work.
Local Supabase application needs exact migration approval. Existing retained
production canaries are explicitly out of scope. Other access PRs landing in
Pika main have main-only authorization, not production authorization.

## Acceptance

Tests prove owner and installation isolation, disabled/replay/conflict handling,
bounded deletion and crash resumption, blocking old success caches, native and
scheduled writes, no outbox resurrection, complete owned-graph absence, and
preserved shared identities/other rosters. Review a fixed SHA; run repository
tests/type/build and Pika focused/DB checks before ready PRs. Roll out only after
both halves and synthetic cross-service failure/retry canaries pass.
