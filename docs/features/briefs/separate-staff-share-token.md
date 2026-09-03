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
  every `/s/` query; a valid `staffShareToken` opens both `/s/` routes with no login;
  the projected QR encodes only the check-in URL; `/s/display/` no longer receives
  participant emails or student IDs; sessions predating the change resolve only by
  their new token; tests cover all three lookups plus the closed-session read path.
