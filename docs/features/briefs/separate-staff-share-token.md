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
- Risks: auth and ownership — this is the fix, but a mistake in which query reads
  which token silently reopens the hole, so each of the three token lookups needs its
  own test. Migration — sessions created before this change have no staff token and
  their existing share links must either keep working or be regenerated, which is the
  open decision below. Ownership — `/s/edit/` mutates attendance with no identity, so
  audit rows land with `source: "standalone_share_token"` and no `appUserId`; that
  stays true unless the surface is moved behind auth.
- Simplification pass: do not build token rotation, expiry UI, or per-link revocation
  in this pass. Splitting the token removes the escalation path, which is most of the
  value; a TTL can follow once the split lands. Consider dropping `schoolEmail` and
  `studentId` from the display payload, since a projected screen needs names and
  counts only — that is a small change and worth folding in.
- Open decision: should `/s/edit/` stay anonymous at all? It is a staff surface that
  writes attendance. Requiring auth there and leaving only `/s/display/` on a shared
  secret is stronger and simpler, but it breaks the hallway-tablet flow if that is a
  real use. Needs a product call before implementation.
- Acceptance criteria: a valid `checkInToken` opens `/check-in/` and returns null from
  every `/s/` query; a valid `staffShareToken` opens both `/s/` routes; the projected
  QR encodes only the check-in URL; existing sessions keep working through the
  migration; tests cover all three lookups plus the closed-session read path.
