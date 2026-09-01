# Pika tenant connection recovery

- Goal: restore an explicitly verified missing installation/tenant connection without duplicating a workspace or changing users, memberships, rosters, or attendance facts.
- Flow: operator verifies historical/current ownership and takes a restricted backup; approves one exact scope; runs read-only inspection; reviews its digest; applies once; verifies normal roster/schedule delivery; disables the repair gate.
- Architecture: internal-only Convex inspection/mutation, exact runtime scope gate, bounded identity/membership checks, state digest, append-only recovery audit. No HTTP or client access, automatic adoption, or delivery side effects.
- Risk: installation identity alone does not prove historical tenant ownership. The operator must verify and explicitly approve the tenant-to-organization binding. Names/slugs never authorize repair. A changed preflight, existing conflicting mapping, foreign identity, disabled member, or oversized inventory fails closed.
- Simplification: no bulk reset, historical backfill, public admin screen, dependency, or automatic rollback. A fresh mutation writes only a mapping and audit in one transaction. Once downstream delivery resumes, rollback requires a separately reviewed recovery plan rather than deletion of the link.
- Acceptance: inspection has no writes; one approved missing link restored; identical replay does not write; conflicting replay rejected; retained data unchanged; concurrent or stale plans rejected. Production execution and deployment require separate exact approval.

This task owns `codex/attendance-tenant-repair`. Pika UI work remains in `codex/daily-checkbox-investigation`.
