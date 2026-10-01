## Separate Staff Share Token From The Student Check-In Token

- User goal: let staff open an attendance session on a second screen or a hallway
  tablet without also handing every student who scans the classroom QR a way to read
  the roster and mark anyone's attendance.
- Problem: one `sessions.checkInToken` is reused by three routes. `/check-in/<token>`
  requires sign-in, but `/s/display/<token>` and `/s/edit/<token>` do not, and both
  call `attendance.getLiveSessionRowsByToken`, which has no authorization check and
  returns every participant's name, `studentId`, `schoolEmail`, attendance status,
  and link status. `/s/edit/<token>` also exposes `attendance.markManualByToken`.
  The QR projected by `components/session-display-screen.tsx` encodes
  `/check-in/<token>`, so any student who scans or photographs it holds the token and
  reaches the staff surfaces by editing the URL. The token has no TTL and no rotation,
  and reads keep resolving after the session closes, so a token captured once reads
  that roster indefinitely.
- UX flow: unchanged for students — scan the QR, sign in, see the result. Staff copy
  the display or manual link from the roster page as they do today; those links now
  carry a different secret that is never rendered as a QR code.
- Primary action: keep the share links one-click for staff while the projected QR
  stops being a credential for anything but self-check-in.
- Architecture plan: add `staffShareToken` to `sessions` in `convex/schema.ts` with a
  `by_staffShareToken` index; mint it beside `checkInToken` in
  `createUniqueCheckInToken`'s caller in `convex/attendanceEngine.ts`; switch
  `getLiveSessionRowsByToken`, `sessions.getDisplayContextByToken`, and
  `markManualByToken` to resolve the staff token; update `buildEditorPath` and
  `buildDisplayPath` callers in `app/rosters/[rosterId]/page.tsx` to pass it; keep
  `resolveCheckInUrl` on `checkInToken`. Backfill existing sessions with a migration
  in `convex/migrations.ts`. Extend `convex/attendance-flow.test.ts` for the token
  split and add Playwright evidence that an old check-in token no longer opens `/s/`.
- Decision (settled): `/s/edit/` stays login-free. Sharing the tap link with another
  teacher so they can mark students in is a real workflow, and requiring an account
  would break it. The link itself remains the credential; the fix is to stop that
  credential from also being the one printed in the QR.
- Risks: auth and ownership — this is the fix, but a mistake in which query reads
  which token silently reopens the hole, so each of the three token lookups needs its
  own test. Ownership — because `/s/edit/` stays anonymous, attendance marks still
  carry no identity: audit rows land with `source: "standalone_share_token"` and no
  `appUserId`, so there is no record of which teacher marked whom. That is an accepted
  consequence of the decision above, not something this pass fixes. Forwarding —
  anyone the link is passed to keeps access for the life of the session, so the link
  should be treated like a door code.
- Simplification pass: do not build token rotation, expiry UI, or per-link revocation
  in this pass. Splitting the token removes the escalation path, which is most of the
  value. Because links are now deliberately forwarded between staff, a regenerate
  action is the most likely follow-up — worth building only once someone needs to
  revoke a shared link. Fold in one small change now: drop `schoolEmail` and
  `studentId` from the display payload, since `/s/display/` renders only the QR and a
  present/total count yet currently fetches the whole roster to the browser.
- Migration: sessions are per-day, so a share link is only useful during that class.
  Existing sessions therefore get a freshly minted `staffShareToken` and their old
  `/s/` links stop resolving; anyone mid-class re-copies from the roster page. This
  costs almost nothing and immediately invalidates any token already exposed through
  a projected QR.
- Acceptance criteria: a valid `checkInToken` opens `/check-in/` and returns null from
  every `/s/` query; a valid `staffShareToken` opens both `/s/` routes while attendance is open;
  the projected QR encodes only the check-in URL; `/s/display/` no longer receives
  participant emails or student IDs; sessions predating the change resolve only by
  their new token; tests cover all three lookups plus the closed-session read path.


## Refresh against current main

- Preserve Pika participant-erasure filtering for both roster rows and aggregate
  counts, and apply the roster-decommission fence to the new counts query.
- Closing a session expires bearer-token roster reads as well as writes. The
  authenticated owner can still read history. The shared projector retains only
  its non-participant context and counts to show the existing closed notice;
  the roster page no longer offers a dead closed-session manual link.
- Reject token collisions across both persisted namespaces and between the two
  tokens minted for a new session. Fail closed if generation exhausts its retries.
- Extend synthetic Convex tests for migration dry runs, cursor batches,
  idempotence, namespace collisions, closed reads, and existing privacy fences.
  Browser fixtures have separate synthetic staff/student tokens; browser smoke
  verifies copied links and QR content, while Convex tests prove backend access.
- Rollout requires the optional field/index and backend to land together, followed
  by the matching frontend. Old `/s/` links fail closed immediately; staff must copy
  new links after backfilling legacy sessions. Run the counts-only live preflight
  below before the backfill, then check `sessionStaffShareTokenBackfillStatus`
  before declaring it complete.
  The migration runner is internal and is not run by ordinary site visits.
- No production deployment, live-data test, or migration is part of this local
  refresh. Staff share links remain bearer credentials while a session is open;
  rotation and individual revocation remain separate future work.

## Production preflight without credential logging

- The pinned migrations component's `dryRun` logs full before/after session
  documents, including tokens. Do not run that dry run against live sessions.
  Keep mutation, collision, rollback, and idempotence checks on synthetic data.
- Use the internal read-only `sessionStaffShareTokenBackfillPreflight` query to
  count live migration eligibility without generating tokens, writing data,
  scheduling work, or logging documents. It scans at most 100 sessions per call
  and returns only per-page aggregate counts plus an opaque pagination cursor.
  A missing `staffShareToken` is eligible; every existing value is preserved.
- After independently verifying the exact production deployment and deploying
  the reviewed backend, start with:

  ```bash
  pnpm exec convex run --deployment-name <verified-production-name> --codegen disable \
    migrations:sessionStaffShareTokenBackfillPreflight '{"cursor":null,"batchSize":100}'
  ```

  Pass the returned `continueCursor` as `cursor` until `isDone: true`; sum
  `scanned`, `pending`, `pendingOpen`, `pendingClosed`, and `alreadyBackfilled`
  across pages. Keep cursors private and report only totals. Pages are separate
  read snapshots, so these are observed counts, not a guarantee against changes
  between calls. This checks scope, not token generation or hosted sign-in.
- Preserve the README's hosted callback/authentication gates. Obtain approval
  for creating persistent staff bearer credentials for the observed eligible
  sessions before running `runSessionStaffShareTokenBackfill`. The backfill
  grants possession-based staff-link access; existing shared links must be
  re-copied. Do not use `--push` or `--identity` to simulate that auth gate.
- After the approved backfill reaches terminal success, verify
  `sessionStaffShareTokenBackfillStatus` reports `complete: true`, then repeat
  the counts-only preflight to confirm zero pending sessions. Migration runner
  `processed` is a scanned-row count, not a newly-created-credential count.
