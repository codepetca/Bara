# Door-Scanner Ticket Attendance

## User goal

Staff want a second attendance mode for a classroom door: instead of students
scanning a shared session QR with their own phone, each student carries a
personal QR ticket and a fixed scanner at the door marks them present as they
walk in, with no computer at the door beyond a mounted kiosk device.

## UX flow

Staff starts a session as today. A kiosk device (old phone/tablet) sits at
the door, plugged into power and on Wi-Fi, running Bara's check-in page in
kiosk mode with a hidden input auto-focused. A USB or Bluetooth barcode/QR
scanner is wired or paired to the kiosk device. Student holds up their
personal ticket (in the student app, wallet pass, or printed badge); the
scanner reads it, emits keystrokes into the focused input, the page
auto-submits on Enter, shows a brief green/red result, clears the field, and
re-focuses for the next student. No login step happens at the door — identity
comes from the ticket itself, so the ticket's own trust model carries the
weight the student's authenticated device carried in the existing shared-QR
mode.

## Primary action

On the kiosk screen, the obvious state is the live scan result (present /
already checked in / invalid / expired) — nothing else competes for
attention. On the student side, the obvious action is showing their current
ticket.

## Architecture plan

- New per-student ticket issuance: a signed, short-lived token scoped to the
  student + roster (and ideally the specific session/day), generated inside
  the student's own signed-in Bara/Pika session — not a static permanent ID.
  Rotate or re-issue per session so a screenshot goes stale quickly and a
  ticket is revocable.
- New Convex mutation/query pair analogous to `student_check_in`, but keyed
  by ticket token instead of session `checkInToken` + authenticated actor;
  still resolves through `auth_identities` / roster ownership and reuses the
  existing attendance-event/state machine (duplicate, expired, invalid,
  closed-session, success) rather than inventing new result states.
- New unauthenticated-input kiosk route (`/scan/[sessionOrRosterToken]`-style)
  built for keyboard-wedge input: a single always-focused field, immediate
  submit-on-Enter, large pass/fail feedback, auto-reset. No staff auth
  required on this route since the trusted actor is the door device, not a
  logged-in person — needs its own authorization story (device-bound token?
  staff-provisioned kiosk link?) distinct from the staff session screen.
- Kiosk operational doc: recommended hardware (old Android phone/tablet +
  USB-OTG or Bluetooth HID scanner), kiosk-browser setup, Wi-Fi requirement,
  power requirement, and an explicit "offline/unconfirmed" UI state rather
  than silently queuing scans — consistent with the roadmap's rule that a
  scan is never claimed successful without a definitive backend result.
- Update tests: Convex ticket-issuance and ticket-check-in domain logic, and
  the new kiosk-route component (keyboard-wedge input handling, result
  states, auto-reset timing).

## Risks

- Security regression vs. today's mode: a personal ticket removes the
  "student's own authenticated device did the scanning" verification. A
  photographed or shared static code becomes a buddy-punch vector unless the
  ticket rotates/expires — this is the central design risk, not a detail.
- Kiosk route is unauthenticated by design (no staff/student login at the
  door) — needs a scoped, revocable way to trust that specific device
  without exposing a general-purpose check-in endpoint.
- Operational fragility: a dead kiosk battery, a kiosk that's asleep/locked,
  or weak Wi-Fi right at the doorway silently breaks attendance for an entire
  class. Needs a visible staff-facing signal when the kiosk hasn't reported
  in, not just a quiet failure at the door.
- Bluetooth pairing drift (scanner un-pairs, wrong input focus after a kiosk
  browser update) is a plausible day-to-day failure mode for non-technical
  staff to debug.
- Two concurrent attendance-capture modes (shared-QR self-scan vs.
  door-scanner ticket) on the same session need clear rules for which one is
  authoritative if both are enabled, and how corrections/manual marking
  interact with door-scanner events.

## Simplification pass

- Ship kiosk hardware as "bring your own old phone/tablet + off-the-shelf
  Bluetooth scanner" — do not build or bundle hardware; write a short setup
  doc instead.
- Start with one ticket rotation policy (e.g., re-issued once per session)
  rather than building configurable rotation cadence.
- Skip printed-badge and wallet-pass issuance for v1; show the ticket only
  inside the student's existing signed-in app view.
- Skip supporting both attendance modes simultaneously on the same session
  for v1 — pick one mode per session to avoid dual-authority ambiguity.
- Skip kiosk device fleet management (multi-door, remote config) — v1 is one
  kiosk, one door, manually set up.

## Acceptance criteria

- Staff can enable door-scanner mode for a session and see a kiosk-ready
  link/route to open on the door device.
- A valid, current ticket scanned at the kiosk marks the student present and
  shows an immediate on-screen result; an expired, invalid, duplicate, or
  closed-session scan produces the expected distinct result state.
- A ticket older than its rotation window fails as expired rather than
  succeeding.
- Kiosk route works end-to-end with real keyboard-wedge input (Bluetooth or
  USB scanner), including refocus after each scan with no manual tap needed.
- Loss of kiosk connectivity is visibly reported as unconfirmed/offline, both
  on the kiosk screen and to staff, not silently dropped.
